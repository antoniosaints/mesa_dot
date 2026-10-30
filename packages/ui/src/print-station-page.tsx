import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { PrintBridgePanel, PrintBridgeProvider } from './printbridge.js';
import { Brand, Icon, ThemeToggle } from './appearance.js';
import { pwaContext } from './pwa-context.js';
import { readStationProfile, stationRequest } from './print-station-runtime.js';
import { TableLoading } from './pagination.js';
import type { Data } from './client.js';
export function PrintStationPage() {
  const unit = pwaContext()?.establishment_id ?? '';
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const profile = readStationProfile(unit);
    if (!profile.credential) {
      setError(
        'Este computador ainda não foi configurado. Entre na gestão, abra Impressão → PrintBridge, vincule as impressoras e ative a fila local.',
      );
      return;
    }
    void stationRequest(unit, profile.credential.token, '/print/station')
      .then((value) => {
        if (live) setData(value);
      })
      .catch((error) => {
        if (live) setError((error as Error).message);
      });
    return () => {
      live = false;
    };
  }, [unit]);
  return (
    <div className="print-station-page">
      <header>
        <Brand />
        <div>
          <Link to="/impressao?aba=printbridge">
            <Icon name="back" size={16} />
            Voltar à gestão
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main>
        <div className="section-head">
          <div>
            <span className="eyebrow">IMPRESSÃO</span>
            <h1>Estação de impressão</h1>
            <p className="muted">
              Receba os trabalhos desta unidade enviados pelo celular, tablet ou outro computador.
            </p>
          </div>
        </div>
        <div className="alert info">
          <Icon name="info" size={18} />
          <p>
            Deixe esta página e o PrintBridge abertos neste computador. A estação funciona com sua
            própria credencial de impressão e continua mesmo se a sessão de gestão for encerrada. Ao
            recarregar, a conexão é retomada.
          </p>
        </div>
        {error ? (
          <div className="alert error" role="alert">
            {error}
          </div>
        ) : !data ? (
          <TableLoading label="Carregando estação…" />
        ) : (
          <PrintBridgeProvider scope={unit} allowed independent>
            <PrintBridgePanel printers={data.printers} independent />
          </PrintBridgeProvider>
        )}
      </main>
    </div>
  );
}
