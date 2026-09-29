import { useEffect, useState } from 'react';
import Home from './pages/Home';
import Simulator from './pages/Simulator';

type Route = 'home' | 'simulator';

function routeFromHash(): Route {
  return window.location.hash.replace('#', '').startsWith('simulator') ? 'simulator' : 'home';
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash());

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (r: Route) => {
    window.location.hash = r === 'home' ? '' : r;
    setRoute(r);
    window.scrollTo(0, 0);
  };

  return route === 'simulator' ? <Simulator onNavigate={navigate} /> : <Home onNavigate={navigate} />;
}
