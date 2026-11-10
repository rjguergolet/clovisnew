import React, { useState, useRef, useEffect } from 'react';

interface AudioTranscriberModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTranscriptionComplete?: (text: string) => void;
  initialPromptPreset?: string;
}

const PROMPT_PRESETS = [
  {
    id: 'geral',
    label: 'Transcrição Fiel',
    badge: 'Geral',
    icon: 'fa-file-lines',
    description: 'Transcrição literal, pontuação natural e máxima precisão.',
    prompt: 'Transcreva este áudio em português com alta precisão, pontuação correta e ortografia formal. Retorne exclusivamente o texto transcrito.'
  },
  {
    id: 'ocorrencia',
    label: 'Ocorrência Disciplinar',
    badge: 'Mediação',
    icon: 'fa-triangle-exclamation',
    description: 'Formata como relato cronológico para registro escolar de ocorrência.',
    prompt: 'Transcreva este áudio sobre ocorrência escolar em português. Organize o texto de forma cronológica, com parágrafos claros, pontuação formal e objetividade, mantendo todos os fatos, nomes e datas citados.'
  },
  {
    id: 'reuniao',
    label: 'Ata de Reunião / Conselho',
    badge: 'Gestão',
    icon: 'fa-users',
    description: 'Formata tópicos e encaminhamentos de reuniões escolares.',
    prompt: 'Transcreva este áudio de reunião escolar ou conselho de classe em português. Estruture o texto com clareza, destacando os pontos debatidos e as deliberações ou combinados finais.'
  },
  {
    id: 'tutoria',
    label: 'Tutoria / Observação PEI',
    badge: 'Pedagógico',
    icon: 'fa-compass',
    description: 'Formata anotações pedagógicas e projeto de vida do estudante.',
    prompt: 'Transcreva este relato pedagógico de tutoria PEI ou observação de estudante em português, garantindo termos pedagógicos adequados e preservando a fidelidade aos apontamentos do educador.'
  }
];

export default function AudioTranscriberModal({
  isOpen,
  onClose,
  onTranscriptionComplete,
  initialPromptPreset = 'geral'
}: AudioTranscriberModalProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [selectedPreset, setSelectedPreset] = useState(initialPromptPreset);
  const [customInstructions, setCustomInstructions] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [transcriptionResult, setTranscriptionResult] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [audioVolume, setAudioVolume] = useState<number[]>(new Array(16).fill(12));

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<any>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Limpa estados ao fechar ou reabrir
  useEffect(() => {
    if (!isOpen) {
      stopRecordingCleanup();
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
      setAudioBlob(null);
      setAudioUrl(null);
      setRecordingDuration(0);
      setErrorMessage('');
      setIsLoading(false);
    }
  }, [isOpen]);

  const stopRecordingCleanup = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close();
      } catch (e) {}
      audioContextRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
    }
    setIsRecording(false);
  };

  const startRecording = async () => {
    setErrorMessage('');
    setTranscriptionResult('');
    setAudioBlob(null);
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Gravação de microfone não suportada neste navegador.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });

      // Visualizador com AudioContext em tempo real
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          audioContextRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 64;
          source.connect(analyser);
          analyserRef.current = analyser;

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateMeter = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArray);
            const bars = [];
            const step = Math.floor(dataArray.length / 16);
            for (let i = 0; i < 16; i++) {
              const val = dataArray[i * step] || 0;
              // Mapeia de 0-255 para 8-48px de altura
              const height = Math.max(8, Math.min(48, Math.round((val / 255) * 44) + 8));
              bars.push(height);
            }
            setAudioVolume(bars);
            animFrameRef.current = requestAnimationFrame(updateMeter);
          };
          updateMeter();
        }
      } catch (audioCtxErr) {
        console.warn('AudioContext visualization not available:', audioCtxErr);
      }

      // Suporta os formatos de áudio mais compatíveis do navegador
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = MediaRecorder.isTypeSupported('audio/webm') 
          ? 'audio/webm' 
          : MediaRecorder.isTypeSupported('audio/mp4') 
            ? 'audio/mp4' 
            : '';
      }

      const recorder = mimeType 
        ? new MediaRecorder(stream, { mimeType }) 
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const finalBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setAudioBlob(finalBlob);
        const url = URL.createObjectURL(finalBlob);
        setAudioUrl(url);

        // Desliga tracks do microfone para liberar o hardware
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start(250);
      setIsRecording(true);
      setRecordingDuration(0);

      timerIntervalRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);

    } catch (err: any) {
      console.error('[Microphone Error]:', err);
      let msg = 'Não foi possível acessar o microfone.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg = 'Permissão para usar o microfone negada. Por favor, habilite o acesso ao microfone nas configurações do seu navegador.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg = 'Nenhum dispositivo de microfone foi encontrado no seu computador ou celular.';
      }
      setErrorMessage(msg);
    }
  };

  const stopRecording = () => {
    stopRecordingCleanup();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('audio/') && !file.name.match(/\.(mp3|wav|m4a|aac|ogg|webm|flac)$/i)) {
      setErrorMessage('Formato inválido. Por favor, selecione um arquivo de áudio (MP3, WAV, M4A, OGG, WebM).');
      return;
    }

    setErrorMessage('');
    setTranscriptionResult('');
    setAudioBlob(file);

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setRecordingDuration(0);
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;
        const cleanBase64 = base64data.includes('base64,') ? base64data.split('base64,')[1] : base64data;
        resolve(cleanBase64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const processTranscription = async () => {
    if (!audioBlob) {
      setErrorMessage('Nenhum áudio disponível para transcrever.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const base64Audio = await blobToBase64(audioBlob);
      const mimeType = audioBlob.type || 'audio/webm';

      const selectedPresetObj = PROMPT_PRESETS.find((p) => p.id === selectedPreset) || PROMPT_PRESETS[0];
      const finalPrompt = customInstructions.trim() 
        ? `${selectedPresetObj.prompt}\nInstruções adicionais: ${customInstructions.trim()}`
        : selectedPresetObj.prompt;

      const response = await fetch('/api/gemini/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio: base64Audio,
          mimeType,
          prompt: finalPrompt,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || data.details || 'Falha ao processar áudio com Gemini 3.5 Transcribe.');
      }

      const text = data.text || '';
      setTranscriptionResult(text);

      if (onTranscriptionComplete && text) {
        onTranscriptionComplete(text);
      }
    } catch (err: any) {
      console.error('[Transcription Error]:', err);
      setErrorMessage(err.message || 'Erro ao comunicar com o servidor de transcrição.');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (!transcriptionResult) return;
    navigator.clipboard.writeText(transcriptionResult);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const downloadTextFile = () => {
    if (!transcriptionResult) return;
    const blob = new Blob([transcriptionResult], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dataHora = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    a.href = url;
    a.download = `transcricao-clovis-${dataHora}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/65 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
      <div 
        className="relative bg-white rounded-3xl shadow-2xl border border-slate-200/90 w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho do Modal com visual moderno e limpo */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 text-indigo-300 flex items-center justify-center shadow-inner">
              <i className="fa-solid fa-microphone-lines text-lg"></i>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold tracking-tight text-white">
                  Gravador & Transcrição Inteligente
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                  gemini-3.5-transcribe
                </span>
              </div>
              <p className="text-xs text-slate-300 font-medium">
                Grave pelo microfone ou envie áudios para converter em texto formal
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            aria-label="Fechar"
          >
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        {/* Corpo do Modal */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 bg-slate-50/50">
          {/* Mensagem de Erro se houver */}
          {errorMessage && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-rose-800 text-xs flex items-start gap-2.5 shadow-2xs">
              <i className="fa-solid fa-circle-exclamation text-rose-600 mt-0.5 shrink-0"></i>
              <div className="flex-1 font-medium">{errorMessage}</div>
            </div>
          )}

          {/* Área Principal de Gravação e Feedback Sonoro */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 text-center flex flex-col items-center justify-center relative shadow-sm">
            
            {/* Visualizador de Gravação Ativa com Ondas Sonoras */}
            {isRecording ? (
              <div className="py-2 flex flex-col items-center w-full">
                <div className="relative flex items-center justify-center mb-4">
                  <span className="absolute w-24 h-24 rounded-full bg-rose-500/15 animate-ping"></span>
                  <span className="absolute w-20 h-20 rounded-full bg-rose-500/25 animate-pulse"></span>
                  <button
                    onClick={stopRecording}
                    className="relative w-16 h-16 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-lg hover:bg-rose-700 transition-all cursor-pointer group hover:scale-105 active:scale-95"
                    title="Concluir Gravação"
                  >
                    <i className="fa-solid fa-stop text-2xl group-hover:scale-110 transition-transform"></i>
                  </button>
                </div>
                
                {/* Ondas Sonoras em Tempo Real */}
                <div className="flex items-center justify-center gap-1.5 h-12 my-2 w-full max-w-xs">
                  {audioVolume.map((h, idx) => (
                    <div
                      key={idx}
                      style={{ height: `${h}px` }}
                      className="w-1.5 rounded-full bg-gradient-to-t from-rose-600 to-indigo-500 transition-all duration-75"
                    ></div>
                  ))}
                </div>

                <div className="text-3xl font-extrabold font-mono text-slate-900 tracking-wider tabular-nums mt-1">
                  {formatDuration(recordingDuration)}
                </div>
                <p className="text-xs font-semibold text-rose-600 mt-1 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                  Microfone ativo gravando... Clique no botão para finalizar.
                </p>
              </div>
            ) : (
              /* Estado Ocioso / Pronto para Gravar ou Arquivo Carregado */
              <div className="w-full py-1 flex flex-col items-center">
                {!audioBlob ? (
                  <>
                    <button
                      onClick={startRecording}
                      disabled={isLoading}
                      className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-700 to-sky-600 text-white flex items-center justify-center shadow-md shadow-indigo-200 hover:shadow-lg hover:scale-105 active:scale-95 transition-all cursor-pointer mb-3.5"
                      title="Iniciar Gravação de Áudio"
                    >
                      <i className="fa-solid fa-microphone text-2xl"></i>
                    </button>
                    <span className="text-sm font-bold text-slate-900">
                      Clique no Microfone para Falar
                    </span>
                    <p className="text-xs text-slate-500 max-w-sm mt-1">
                      Fale com naturalidade para ditar ocorrências, atas, tutoria ou recados pedagógicos.
                    </p>

                    <div className="my-3.5 flex items-center gap-3 w-full max-w-xs">
                      <div className="h-px bg-slate-200 flex-1"></div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ou envie áudio gravado</span>
                      <div className="h-px bg-slate-200 flex-1"></div>
                    </div>

                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.webm"
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-300/80 shadow-2xs transition-colors cursor-pointer"
                    >
                      <i className="fa-solid fa-cloud-arrow-up text-indigo-600"></i>
                      <span>Selecionar Arquivo de Áudio</span>
                    </button>
                  </>
                ) : (
                  /* Áudio Gravado / Carregado Pronto */
                  <div className="w-full flex flex-col items-center">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 flex items-center gap-1.5 shadow-2xs">
                        <i className="fa-solid fa-circle-check text-emerald-600 text-xs"></i>
                        Áudio Pronto ({recordingDuration > 0 ? formatDuration(recordingDuration) : `${(audioBlob.size / 1024).toFixed(1)} KB`})
                      </span>
                    </div>

                    {audioUrl && (
                      <audio
                        ref={audioPlayerRef}
                        controls
                        src={audioUrl}
                        className="w-full max-w-md h-10 my-2"
                      />
                    )}

                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={startRecording}
                        className="text-xs text-slate-600 hover:text-indigo-600 font-semibold px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                      >
                        <i className="fa-solid fa-rotate-left mr-1"></i> Gravar Novamente
                      </button>
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs text-slate-600 hover:text-indigo-600 font-semibold px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                      >
                        <i className="fa-solid fa-upload mr-1"></i> Trocar Arquivo
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Seleção do Modo / Preset de Transcrição */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2 uppercase tracking-wider">
              Objetivo da Transcrição:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {PROMPT_PRESETS.map((preset) => (
                <div
                  key={preset.id}
                  onClick={() => setSelectedPreset(preset.id)}
                  className={`p-3.5 rounded-2xl border text-left cursor-pointer transition-all select-none ${
                    selectedPreset === preset.id
                      ? 'border-indigo-600 bg-indigo-50/70 shadow-xs ring-1 ring-indigo-600/30'
                      : 'border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <i className={`fa-solid ${preset.icon} text-xs ${selectedPreset === preset.id ? 'text-indigo-600' : 'text-slate-400'}`}></i>
                      <span className="text-xs font-bold text-slate-900">{preset.label}</span>
                    </div>
                    {selectedPreset === preset.id && (
                      <i className="fa-solid fa-circle-check text-indigo-600 text-xs"></i>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                    {preset.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Instruções Adicionais Opcionais */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
              Instruções Opcionais para a IA:
            </label>
            <input
              type="text"
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="Ex: Identifique o nome do estudante Lucas do 8º Ano A..."
              className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-slate-400"
            />
          </div>

          {/* Botão de Disparo da Transcrição */}
          {audioBlob && !isRecording && (
            <div className="pt-1">
              <button
                onClick={processTranscription}
                disabled={isLoading}
                className="w-full py-3.5 px-4 rounded-2xl font-bold text-sm text-white bg-gradient-to-r from-indigo-600 via-indigo-700 to-sky-600 hover:from-indigo-700 hover:to-sky-700 shadow-md shadow-indigo-200 flex items-center justify-center gap-2.5 cursor-pointer transition-all disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <i className="fa-solid fa-circle-notch fa-spin text-base"></i>
                    <span>Transcrevendo com Gemini 3.5 Transcribe...</span>
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-wand-magic-sparkles text-base"></i>
                    <span>Iniciar Transcrição Inteligente</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Resultado da Transcrição */}
          {transcriptionResult && (
            <div className="mt-4 pt-4 border-t border-slate-200 space-y-3 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Texto Transcrito:
                  </span>
                  <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
                    ({transcriptionResult.trim().split(/\s+/).length} palavras)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={copyToClipboard}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 hover:text-indigo-600 bg-white hover:bg-indigo-50 border border-slate-200 shadow-2xs transition-colors cursor-pointer"
                  >
                    <i className={`fa-solid ${copied ? 'fa-check text-emerald-600' : 'fa-copy'}`}></i>
                    <span>{copied ? 'Copiado!' : 'Copiar Texto'}</span>
                  </button>
                  <button
                    onClick={downloadTextFile}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 hover:text-indigo-600 bg-white hover:bg-indigo-50 border border-slate-200 shadow-2xs transition-colors cursor-pointer"
                    title="Baixar em formato .txt"
                  >
                    <i className="fa-solid fa-download"></i>
                    <span>Baixar .TXT</span>
                  </button>
                </div>
              </div>

              <textarea
                value={transcriptionResult}
                onChange={(e) => setTranscriptionResult(e.target.value)}
                rows={6}
                className="w-full p-4 rounded-2xl border border-slate-300/90 text-sm font-normal text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 leading-relaxed bg-white shadow-2xs"
                placeholder="O texto transcrito aparecerá aqui..."
              />
            </div>
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="px-6 py-3.5 bg-white border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1.5 text-[11px]">
            <i className="fa-solid fa-shield-halved text-emerald-600"></i>
            <span>Processamento seguro server-side com modelo Gemini 3.5 Transcribe</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
