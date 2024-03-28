import React, { useState, useEffect, useRef } from "react";
import socket from "../components/socket";
import Send from "../components/send";
import Receive from "../components/receive";

export default function Home() {
  const [isSending, setIsSending] = useState(true);
  const [allowSending, setAllowSending] = useState(false);
  return (
    <div className="bg-black text-white h-screen">
      <h1 className="text-center text-7xl">Home</h1>
      <div className="flex-row flex w-screen justify-center mt-20 gap-20 text-2xl">
        <button
          className="border-2 rounded-lg w-28"
          onClick={() => setIsSending(true)}
        >
          Send
        </button>
        <button
          className="border-2 rounded-lg w-28"
          onClick={() => setIsSending(false)}
        >
          Receive
        </button>
      </div>
      {isSending ? <Send allowSending={allowSending} /> : <Receive />}
    </div>
  );
}
