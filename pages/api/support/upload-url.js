import crypto from 'crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getS3Client, getS3Config } from '../../../server/s3';
import { getUserFromRequest } from '../../../lib/auth';
import { applyCors } from '../../../server/cors';

const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB

function sanitizeFilename(name) {
  return (name || 'upload')
    .toLowerCase()
    .replace(/[^a-z0-9.\-_]/g, '-')
    .slice(0, 80);
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }

  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const { fileName, fileType, fileSize } = req.body || {};
    if (!fileName || !fileType || !fileSize) {
      return res.status(400).json({ error: 'missing file metadata' });
    }
    if (!String(fileType).startsWith('image/')) {
      return res.status(400).json({ error: 'only image uploads are allowed' });
    }
    if (Number(fileSize) > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({ error: 'image too large (max 8MB)' });
    }

    const safeName = sanitizeFilename(fileName);
    const ext = safeName.includes('.') ? safeName.slice(safeName.lastIndexOf('.')) : '';
    const key = `support/${user.id}/${Date.now()}-${crypto.randomUUID()}${ext}`;

    const { bucket, publicBaseUrl } = getS3Config();
    const s3Client = getS3Client();

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: fileType,
      ACL: 'public-read',
    });
    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 60 });

    return res.status(200).json({
      uploadUrl,
      fileUrl: `${publicBaseUrl}/${key}`,
      key,
    });
  } catch (e) {
    console.error('support upload-url error', e);
    return res.status(500).json({ error: 'internal' });
  }
}
