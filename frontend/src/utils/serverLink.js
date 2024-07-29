let serverAddress = '';

if(process.env.NODE_ENV === 'production'){
     serverAddress =  'https://p2p-fileshare-server.vercel.app';
}
else{
    serverAddress =  'http://localhost:3000';
}
export default serverAddress;