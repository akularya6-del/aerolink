const http = require('http');
const fs = require('fs');

const server = http.createServer((req, res) => {
  console.log(`Received: ${req.method} ${req.url}`);
  
  const headersStr = JSON.stringify(req.headers, null, 2);
  console.log(`Headers: ${headersStr}`);
  fs.appendFileSync('capture.log', `\n\n=== ${req.method} ${req.url} ===\nHEADERS:\n${headersStr}\nBODY:\n`);

  let body = [];
  req.on('data', chunk => body.push(chunk));
  req.on('end', () => {
    const fullBody = Buffer.concat(body).toString();
    console.log(`Body: ${fullBody}`);
    fs.appendFileSync('capture.log', fullBody);
    
    // Respond OK
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.method === 'POST') {
      res.end(JSON.stringify({
        id: "msg_123",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "Hello!" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 }
      }));
    } else {
      res.end();
    }
  });
});

server.listen(3000, () => {
  console.log('Capture server listening on 3000');
});
