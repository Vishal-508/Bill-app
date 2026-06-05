import { Construction } from 'lucide-react';
import { EmptyState } from '../components/ui/EmptyState.jsx';

export default function Placeholder({ title }) {
  return (
    <EmptyState
      icon={<Construction size={24} />}
      title={`${title} module`}
      description="This page will be built in a later prompt (11–13). The route is wired and ready."
    />
  );
}
