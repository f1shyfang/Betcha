async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('FAIL: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
    process.exit(1);
  }

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/users?select=id&limit=1`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('FAIL: Supabase REST connection failed');
      console.error(`Status: ${response.status}`);
      console.error(body);
      process.exitCode = 1;
      return;
    }

    const rows = await response.json();
    console.log('PASS: Supabase REST connection successful');
    console.log(`Rows returned: ${Array.isArray(rows) ? rows.length : 0}`);
  } catch (err) {
    console.error('FAIL: Supabase REST connection failed');
    console.error(err.message);
    process.exitCode = 1;
  }
}

main();
