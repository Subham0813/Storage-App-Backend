// Cloudflare Worker: worker.js

// Replace with your actual backend URL where your Node.js API is hosted
const BACKEND_URL = "https://api.your-domain.com";
const WEBHOOK_SECRET = "your_super_secret_webhook_password"; 

async function verifyHMAC(payload, signature) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const signatureBytes = new Uint8Array(
    signature.match(/.{1,2}/g).map((byte) => parseInt(byte, 16))
  );

  return await crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(payload));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const tokenParams = url.searchParams.get("token");

    if (!tokenParams) return new Response("Missing token", { status: 401 });

    try {
      const decoded = atob(tokenParams);
      const [payloadStr, providedSignature] = decoded.split("|");

      const isValid = await verifyHMAC(payloadStr, providedSignature);
      if (!isValid) return new Response("Invalid signature", { status: 403 });

      const payload = JSON.parse(payloadStr);
      const s3Request = new Request(payload.url, request);
      s3Request.headers.delete("Origin");

      const s3Response = await fetch(s3Request);

      // ==========================================
      // BYTE COUNTING STREAM INTERCEPTOR
      // ==========================================
      let bytesSent = 0;
      
      const transformStream = new TransformStream({
        transform(chunk, controller) {
          bytesSent += chunk.byteLength;
          controller.enqueue(chunk);
        },
        flush() {
          // The stream finished or was aborted. Send the exact byte count to the backend.
          // ctx.waitUntil ensures the webhook fires even after the user disconnects.
          ctx.waitUntil(
            fetch(`${BACKEND_URL}/api/files/webhook/bandwidth`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-cf-webhook-auth": WEBHOOK_SECRET,
              },
              body: JSON.stringify({
                token: tokenParams,
                bytesSent: bytesSent,
              }),
            }).catch(err => console.error("Webhook Delivery Failed:", err))
          );
        }
      });

      const proxyResponse = new Response(
        s3Response.body.pipeThrough(transformStream), 
        s3Response
      );
      
      proxyResponse.headers.set("Access-Control-Allow-Origin", "*");
      return proxyResponse;

    } catch (err) {
      return new Response("Edge processing error", { status: 500 });
    }
  },
};