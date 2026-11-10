import React from 'react';

/**
 * Componente Reutilizável de Estado Vazio
 * Escola Clóvis de Lucca 20.0 - UX/UI Ergonômico
 */
export default function MascoteSaraState({
  titulo = "Nenhum registro encontrado por aqui!",
  mensagem = "Tente ajustar os termos da busca ou selecionar outros filtros para localizar as informações.",
  actionButton = null,
  compact = false
}) {
  if (compact) {
    return (
      <div className="bg-slate-50 border border-slate-300 rounded-2xl p-4 text-center space-y-2 my-2 shadow-2xs">
        <div className="flex items-center justify-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-950 text-cyan-300 flex items-center justify-center text-sm font-black shadow-xs ring-2 ring-cyan-400/40 shrink-0">
            <i className="fa-solid fa-graduation-cap text-xs"></i>
          </div>
          <div className="text-left">
            <span className="text-[10px] font-black uppercase tracking-wider text-cyan-700 block">
              Sistema Clóvis 20.0
            </span>
            <p className="text-xs font-bold text-slate-800">{titulo}</p>
          </div>
        </div>
        {mensagem && <p className="text-[11px] text-slate-500 font-medium">{mensagem}</p>}
        {actionButton && <div className="pt-1">{actionButton}</div>}
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center space-y-4 shadow-sm max-w-lg mx-auto my-4">
      <div className="relative inline-block">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-950 via-slate-900 to-blue-900 text-cyan-300 flex items-center justify-center text-2xl shadow-md ring-4 ring-cyan-400/30 mx-auto">
          <i className="fa-solid fa-graduation-cap"></i>
        </div>
        <span className="absolute -bottom-2 -right-2 bg-cyan-400 text-blue-950 text-[9px] font-black uppercase px-2 py-0.5 rounded-full shadow-xs border border-white">
          v20.0
        </span>
      </div>

      <div className="space-y-1">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-50 border border-cyan-200 text-cyan-900 text-[10px] font-extrabold uppercase tracking-wider mb-1">
          <i className="fa-solid fa-school text-cyan-600"></i>
          <span>EE Prof. Clóvis de Lucca</span>
        </div>
        <h3 className="text-base font-extrabold text-blue-950">{titulo}</h3>
        <p className="text-xs text-slate-500 font-medium leading-relaxed max-w-xs mx-auto">
          {mensagem}
        </p>
      </div>

      {actionButton && <div className="pt-2">{actionButton}</div>}
    </div>
  );
}
