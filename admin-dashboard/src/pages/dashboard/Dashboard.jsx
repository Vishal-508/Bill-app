import { useSelector } from 'react-redux';
import { selectUser } from '../../store/index.js';
import { Card } from '../../components/ui/Card.jsx';

export default function Dashboard() {
  const user = useSelector(selectUser);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-secondary-900">
        Welcome back, {user?.name || 'Admin'}!
      </h1>
      <Card>
        <Card.Body>
          <p className="text-secondary-600">
            Dashboard widgets coming in Prompt 13 (Analytics).
          </p>
          <p className="text-sm text-secondary-500 mt-2">
            This is the post-login landing page. Use the sidebar to
            navigate to other modules — most are placeholders until
            Prompts 11–13 ship the module UIs.
          </p>
        </Card.Body>
      </Card>
    </div>
  );
}
