import {  configureStore } from '@reduxjs/toolkit'
import { produce } from "immer";

const initialState = {
    isReceiving : false,
    sizeReceived : 0,
    bytesWritten : 0,
    transferSize : 0,
    isConnected : false,
    file : null,
    metadata : null,
    transferStatus: "idle",
    writeMode: null,
    error: null,
    resolvedFileName: null,
    reorderBufferSize: 0,
    highestContiguousWrittenIndex: -1,
}

const keyReducer = (state = initialState, action) => {
    return produce(state, draft => {
        switch(action.type){
            case 'RECEIVE':
                draft.isReceiving = true;
                if (draft.writeMode === "blob-fallback") {
                    draft.transferStatus = "fallback-buffering";
                } else {
                    draft.transferStatus = "streaming-direct-write";
                }
                break;
            case 'SIZE_RECEIVED':
                draft.sizeReceived = action.payload;
                break;
            case 'BYTES_WRITTEN':
                draft.bytesWritten = action.payload;
                break;
            case 'RESET_TRANSFER':
                draft.isReceiving = false;
                draft.sizeReceived = 0;
                draft.bytesWritten = 0;
                draft.transferSize = 0;
                draft.metadata = null;
                draft.transferStatus = "idle";
                draft.writeMode = null;
                draft.error = null;
                draft.resolvedFileName = null;
                draft.reorderBufferSize = 0;
                draft.highestContiguousWrittenIndex = -1;
                break;
            case 'ALL_CONNECTED':
                draft.isConnected = true;
                console.log("All connected");
                break;
            case 'METADATA':
                draft.metadata = action.payload;
                break;
            case 'TRANSFER_UPDATE':
                Object.assign(draft, action.payload);
                break;
            default:
                return state;
        }
    });
}

const store = configureStore({
    reducer: {
        key: keyReducer
    }
})
export default store;
