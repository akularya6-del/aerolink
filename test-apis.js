const keys = [
  "aero_live_9xNUHuvcFzafkrfBTy4PCcX4lM8KwuOIYkps_tFy3hE",
  "aero_live_vogvaNZ6Q38PnKam5aGqsGiFkAUNhgviLQl7o1E0jiY",
  "aero_live_tmGh4TXXeCfnc-Lfy_LPCNgsTjm2B_DevDRk1mna_PY",
  "aero_live_bqiqQ9-eLul_qrZ4siPw3AeAhoZY2CUmd1bN3oJxx3k",
  "aero_live_3gmb1YET0Kn7-OVC-poTKxLQYyzWZEV0r_2he0Iwol0",
  "aero_live_MccHr2sX9DpSQLr7qgHohKuJNmyzXPthqKWycmZISwU",
  "aero_live_d1a4IjJsFcghGf4c95-bx1LlWGmIouzGcff8UUFdDZA",
  "aero_live_sxfoRWOqY5b6kViyHUBQV3hctpogxs-ro9R9lCDkLIA",
  "aero_live_YPJdpDOGvKWfg6Uiz9zDFW2aXpmZeto1OAvoBUvZr-g",
  "aero_live_bCgNRKVw2zbwpgfULenKdECOkNA3GCuoZ-V6Nx5Ars4"
];

async function testKeys() {
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      console.log(`Testing Key ${i + 1}...`);
      for (let j = 0; j < 1; j++) {
        const response = await fetch('https://capi.aerolink.lat/v1/messages?beta=true', {
          method: 'POST',
          headers: {
            'x-api-key': key,
            'content-type': 'application/json',
            'anthropic-version': '2023-06-01',
            'user-agent': 'Bun/1.4.0'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            messages: [{ role: 'user', content: `Say OK ${j}` }],
            max_tokens: 10
          })
        });

        const body = await response.text();
        console.log(`Key ${i + 1} Req ${j + 1} Status: ${response.status}`);
        console.log(`Key ${i + 1} Req ${j + 1} Body: ${body.substring(0, 100)}`);
        
        const reset = response.headers.get('x-ratelimit-reset');
        const retry = response.headers.get('retry-after');
        if (reset || retry) {
          console.log(`Key ${i + 1} Req ${j + 1} Headers -> reset: ${reset}, retry: ${retry}`);
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      console.log('---');
    } catch (e) {
      console.error(`Key ${i + 1} Fetch Failed:`, e.message);
    }
    
    // Add a small delay between keys
    await new Promise(r => setTimeout(r, 2000));
  }
}

testKeys();
