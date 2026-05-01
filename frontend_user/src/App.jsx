import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Dashboard from './pages/Dashboard';
import Recommendations from './pages/Recommendations';
import TopStocks from './pages/TopStocks';
import InvestorDetails from './pages/InvestorDetails';
import Transactions from './pages/Transactions';
import './index.css';

function App() {
  return (
    <BrowserRouter>
      <div className="app-container">
        <Navbar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/recommendations" element={<Recommendations />} />
            <Route path="/stocks" element={<TopStocks />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/investor/:id" element={<InvestorDetails />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
