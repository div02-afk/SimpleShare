import {  configureStore } from '@reduxjs/toolkit'
import { produce } from "immer";

const initialState = {
    isReceiving : false,
    sizeReceived : 0,
    isConnected : false,
    file : null,
    metadata : null
}

const keyReducer = (state = initialState, action) => {
    return produce(state, draft => {
        switch(action.type){
            case 'RECEIVE':
                draft.isReceiving = true;
                break;
            case 'SIZE_RECEIVED':
                draft.sizeReceived = action.payload;
                break;
            case 'ALL_CONNECTED':
                draft.isConnected = true;
                console.log("All connected");
                break;
            case 'METADATA':
                
                draft.metadata = action.payload;
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
