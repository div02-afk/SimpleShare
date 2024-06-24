import React, { useEffect,useState } from 'react';
import {Receiver} from "./utils/connection";

import peerConnection from './utils/peerConnectionSetup';
export default function Send() {
    
    
    
    const [connection, setConnection] = useState(null);
    const [uniqueId, setUniqueId] = useState('');
    const connect = () => {
      const conn = new Receiver(peerConnection, uniqueId);
      setConnection(conn);
    }
    

    return (
        <div className="receive">
        <h1>Receive</h1>
        <p>Welcome to the receive page!</p>
        <input value={uniqueId} onChange={(e)=>{setUniqueId(e.target.value)}} placeholder='Unique id'></input>
        <button onClick={()=>{
            connect()
        } }>Receive</button>
        </div>
    );
}