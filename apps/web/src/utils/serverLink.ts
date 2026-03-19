const productionServerAddress = "https://p2p-fileshare.onrender.com";

function getDevelopmentServerAddress(): string {
  const configuredAddress = import.meta.env.VITE_SIGNALING_SERVER_URL?.trim();
  if (configuredAddress) {
    return configuredAddress;
  }

  if (typeof window === "undefined") {
    return "http://localhost:3000";
  }

  const { hostname, protocol } = window.location;
  const resolvedHostname = hostname || "localhost";
  const resolvedProtocol = protocol === "https:" ? "https:" : "http:";

  return `${resolvedProtocol}//${resolvedHostname}:3000`;
}

const serverAddress = import.meta.env.PROD
  ? productionServerAddress
  : getDevelopmentServerAddress();

export default serverAddress;
