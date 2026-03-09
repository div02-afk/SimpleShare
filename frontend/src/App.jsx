import {BrowserRouter,Routes, Route} from 'react-router-dom';
import Home from './home';
import Send from './send';
import Receive from './receive';
import ProjectOverview from './projectOverview';

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/send" element={<Send />} />
                <Route path="/receive" element={<Receive />} />
                <Route path="/how-it-works" element={<ProjectOverview />} />
            </Routes>
        </BrowserRouter>
    );
}
