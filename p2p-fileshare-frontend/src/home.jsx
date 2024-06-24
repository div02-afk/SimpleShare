export default function Home() {
    return (
        <div className="home">
        <h1>Home</h1>
        <p>Welcome to the home page!</p>
        <button onClick={()=>{
            window.location.href = "/send";
        }}>Send</button>
        <button onClick={()=>{
            window.location.href = "/receive";
        }}>Receive</button>
        </div>
    );
}