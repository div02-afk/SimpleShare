async function testStunServer(stunServerUrl) {
  const configuration = { iceServers: [{ urls: stunServerUrl }] };
  const peerConnection = new RTCPeerConnection(configuration);

  try {
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await peerConnection.setLocalDescription(offer);

    // Wait for ICE candidate to be gathered
    await new Promise((resolve) => {
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          console.log("ICE candidate:", event.candidate);
          resolve();
        }
      };
    });

    // ICE gathering complete
    console.log("ICE gathering complete");
  } catch (error) {
    console.error("Error testing STUN server:", error);
  } finally {
    peerConnection.close();
  }
}

// Usage example
console.log("Testing STUN server...");
testStunServer("stun:stun.l.google.com:19302");
