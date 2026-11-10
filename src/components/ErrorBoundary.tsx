import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary capturou um erro no componente:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  override render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 md:p-8 bg-slate-50 min-h-[300px] flex items-center justify-center">
          <div className="max-w-xl w-full bg-white border border-rose-200 rounded-2xl p-6 shadow-lg text-slate-800">
            <div className="flex items-center gap-3 mb-4 text-rose-600">
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center shrink-0">
                <i className="fa-solid fa-triangle-exclamation text-xl"></i>
              </div>
              <div>
                <h3 className="font-extrabold text-base">
                  {this.props.fallbackTitle || 'Falha temporária ao carregar o módulo'}
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Os dados locais foram preservados e o sistema impediu o encerramento da aplicação.
                </p>
              </div>
            </div>

            {this.state.error && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-4 text-xs font-mono text-slate-700 overflow-x-auto">
                <p className="font-bold text-rose-700 mb-1">{this.state.error.name}: {this.state.error.message}</p>
              </div>
            )}

            <div className="flex items-center gap-3 justify-end">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-bold transition cursor-pointer shadow-sm"
              >
                <i className="fa-solid fa-arrows-rotate mr-1.5"></i>
                Recarregar Módulo
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition cursor-pointer"
              >
                Atualizar Página
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}


