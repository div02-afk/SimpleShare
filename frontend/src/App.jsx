import {BrowserRouter,Routes, Route} from 'react-router-dom';
import Home from './home';
import Send from './send';
import Receive from './receive';

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/send" element={<Send />} />
                <Route path="/receive" element={<Receive />} />
            </Routes>
        </BrowserRouter>
    );
}