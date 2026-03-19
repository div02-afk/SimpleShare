import { config } from "dotenv";

config();

const API_KEY = process.env.CLOUDFLARE_API_KEY;
const TOKEN_ID = process.env.CLOUDFLARE_TOKEN_ID;

export const getIceServers = async (): Promise<RTCIceServer[]> => {
  if (!API_KEY || !TOKEN_ID) {
    throw new Error(
      "CLOUDFLARE_API_KEY and CLOUDFLARE_TOKEN_ID must be set in the environment variables."
    );
  }

  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${TOKEN_ID}/credentials/generate-ice-servers`,
    {
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      body: JSON.stringify({ ttl: 86400 }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch ICE servers: ${response.statusText}`);
  }

  const data = (await response.json()) as { iceServers: RTCIceServer[] };
  return data.iceServers;
};
