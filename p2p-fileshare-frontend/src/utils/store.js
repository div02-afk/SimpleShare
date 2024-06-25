import {  configureStore } from '@reduxjs/toolkit'
import { produce } from "immer";

const initialState = {
    isReceiving : false,
    sizeReceived : 0,
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
