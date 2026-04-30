const { S3Client } = require('@aws-sdk/client-s3');

let s3Client = null;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function getS3Config() {
  const bucket = requireEnv('S3_BUCKET_NAME');
  const region = requireEnv('S3_REGION');
  const accessKeyId = requireEnv('S3_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv('S3_SECRET_ACCESS_KEY');
  const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL || `https://${bucket}.s3.${region}.amazonaws.com`;
  return { bucket, region, accessKeyId, secretAccessKey, publicBaseUrl };
}

function getS3Client() {
  if (!s3Client) {
    const { region, accessKeyId, secretAccessKey } = getS3Config();
    s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }
  return s3Client;
}

module.exports = {
  getS3Client,
  getS3Config,
};
