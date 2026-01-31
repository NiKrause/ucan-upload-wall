import { AlertCircle, CheckCircle, X } from 'lucide-react';

interface AlertProps {
  type: 'success' | 'error';
  message: string;
  onClose: () => void;
}

export function Alert({ type, message, onClose }: AlertProps) {
  const isSuccess = type === 'success';

  return (
    <div
      className={`
        fixed top-6 right-6 max-w-md w-full shadow-lg rounded-xl p-4 flex items-start gap-3
        ${isSuccess ? 'bg-green-50 border border-green-200' : 'bg-primary-50 border border-primary-200'}
        animate-fade-in
      `}
    >
      {isSuccess ? (
        <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center flex-shrink-0">
          <CheckCircle className="w-4 h-4 text-white" />
        </div>
      ) : (
        <div className="w-8 h-8 bg-storacha-red rounded-lg flex items-center justify-center flex-shrink-0">
          <AlertCircle className="w-4 h-4 text-white" />
        </div>
      )}
      <div className={`flex-1 text-sm ${isSuccess ? 'text-green-800' : 'text-primary-800'}`}>
        {message.split('\n').map((line, index) => (
          <div key={index} className={index === 0 ? 'font-medium' : 'font-normal mt-1'}>
            {line}
          </div>
        ))}
      </div>
      <button
        onClick={onClose}
        className={`
          p-1.5 rounded-lg transition-colors
          ${isSuccess ? 'hover:bg-green-100 text-green-600' : 'hover:bg-primary-100 text-primary-600'}
        `}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
