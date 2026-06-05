import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '../components/ui/Button.jsx';
import { ROUTES } from '../utils/constants.js';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-secondary-50 flex items-center justify-center p-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 h-16 w-16 rounded-full bg-secondary-100 flex items-center justify-center text-secondary-400">
          <Compass size={28} />
        </div>
        <h1 className="text-3xl font-semibold text-secondary-900">404</h1>
        <p className="mt-1 text-secondary-600">
          That page isn't here.
        </p>
        <Link to={ROUTES.DASHBOARD} className="inline-block mt-6">
          <Button variant="primary">Go to Dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
