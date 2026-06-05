import { Search } from 'lucide-react';
import { Input } from '../ui/Input.jsx';
import { Button } from '../ui/Button.jsx';
import { Badge } from '../ui/Badge.jsx';

export function DataTableToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search…',
  bulkActions,
  selectedCount = 0,
  children, // filter slot — caller-supplied filter pills/dropdowns
}) {
  const hasSearch = typeof onSearchChange === 'function';
  const hasBulk = Array.isArray(bulkActions) && bulkActions.length > 0 && selectedCount > 0;

  // Render nothing if no toolbar content at all.
  if (!hasSearch && !hasBulk && !children) return null;

  return (
    <div className="flex flex-col gap-2 px-4 py-3 border-b border-secondary-200
                    sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {hasSearch && (
          <div className="w-full max-w-xs">
            <Input
              type="search"
              value={searchValue ?? ''}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              prefix={<Search size={16} />}
              size="sm"
            />
          </div>
        )}
        {children}
      </div>

      {hasBulk && (
        <div className="flex items-center gap-2">
          <Badge variant="info" size="sm">Selected: {selectedCount}</Badge>
          {bulkActions.map((action, i) => {
            const Icon = action.icon;
            return (
              <Button
                key={action.label || i}
                size="sm"
                variant={action.variant || 'secondary'}
                onClick={() => action.onClick()}
                leftIcon={Icon ? <Icon size={14} /> : undefined}
              >
                {action.label}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default DataTableToolbar;
