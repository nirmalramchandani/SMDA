import { NavLink } from 'react-router-dom';
import { Activity, TrendingUp, BarChart3, Users, Clock } from 'lucide-react';

export default function Navbar() {
  const links = [
    { name: 'Top Performers', path: '/', icon: <Users size={18} /> },
    { name: 'Recent Activity', path: '/transactions', icon: <Clock size={18} /> },
    { name: 'Trade Signals', path: '/recommendations', icon: <Activity size={18} /> },
    { name: 'Top Stocks', path: '/stocks', icon: <TrendingUp size={18} /> },
  ];

  return (
    <nav className="navbar">
      <NavLink className="nav-brand" to="/">
        <BarChart3 size={28} color="var(--accent-blue)" />
        SMDA Intelligence
      </NavLink>

      <div className="nav-links">
        {links.map((link) => (
          <NavLink
            key={link.path}
            to={link.path}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            {link.icon}
            {link.name}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
