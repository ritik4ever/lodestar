import Link from 'next/link';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  message: string;
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  className?: string;
}

export default function EmptyState({ icon, title, message, action, className = '' }: EmptyStateProps) {
  return (
    <div className={`card p-12 text-center ${className}`}>
      <div className="mx-auto mb-6 flex items-center justify-center w-20 h-20 rounded-full bg-border/30 text-secondary/50">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-secondary max-w-md mx-auto leading-relaxed">{message}</p>
      {action && (
        <div className="mt-6">
          {action.href ? (
            <Link href={action.href} className="btn-primary px-6 py-2.5 text-sm">
              {action.label}
            </Link>
          ) : (
            <button onClick={action.onClick} className="btn-primary px-6 py-2.5 text-sm">
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
