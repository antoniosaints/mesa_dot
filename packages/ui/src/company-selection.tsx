import { useEffect, useRef, useState } from 'react';
import { SearchSelect } from './controls.js';
import { TableLoading } from './pagination.js';
import { Icon } from './appearance.js';
import { api, type Data } from './client.js';
import { parsePwaPath, safePwaSearch, type PwaSurface } from '../../shared/src/pwa.js';
export function CompanySelection({ surface }: { surface: PwaSurface }) {
  const [companies, setCompanies] = useState<Data[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  async function load() {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError('');
    try {
      const list = await api(
        '/auth/establishments',
        undefined,
        undefined,
        undefined,
        'json',
        controller.signal,
      );
      if (!controller.signal.aborted) setCompanies(list);
    } catch (error) {
      if (!controller.signal.aborted) setError((error as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    return () => pending.current?.abort();
  }, []);
  function choose(slug: string) {
    if (!/^[a-z0-9-]{1,80}$/.test(slug) || !companies.some((company) => company.slug === slug))
      return;
    const candidate =
      '/' + slug + (window.location.pathname === '/' ? '/' : window.location.pathname);
    const entry = parsePwaPath(candidate, surface);
    const path = '/' + slug + '/' + (entry?.rest ?? '');
    const search = safePwaSearch(new URLSearchParams(window.location.search), surface);
    window.location.assign(path + (search ? '?' + search : ''));
  }
  return (
    <section className="login-form company-selection" aria-labelledby="company-selection-heading">
      <span className="eyebrow">SEU AMBIENTE DE TRABALHO</span>
      <h2 id="company-selection-heading">Selecione sua empresa</h2>
      <p className="muted">Escolha o estabelecimento para acessar o ambiente da sua equipe.</p>
      {loading ? (
        <TableLoading label="Carregando empresas…" compact />
      ) : error ? (
        <div className="alert error" role="alert">
          <p>Não foi possível carregar as empresas. Tente novamente.</p>
          <button onClick={() => void load()}>
            <Icon name="refresh" size={16} />
            Tentar novamente
          </button>
        </div>
      ) : companies.length ? (
        <>
          <label>
            <span>Empresa</span>
            <SearchSelect
              label="Empresa"
              options={companies.map((company) => ({
                id: company.slug,
                name: company.name.toLocaleUpperCase('pt-BR'),
                searchText: company.slug,
              }))}
              className="company-directory-select"
              popupClassName="company-select-options"
              renderOptionLeading={(option) => (
                <CompanyLogo
                  name={option.name}
                  src={companies.find((company) => company.slug === option.id)?.icon_url}
                />
              )}
              value=""
              onChange={choose}
              placeholder="Busque pelo nome da empresa…"
              allowClear={false}
            />
          </label>
          <p className="login-selection-hint">
            <Icon name="next" size={16} />
            Ao selecionar, você será direcionado para o login da empresa.
          </p>
        </>
      ) : (
        <div className="login-directory-empty">
          <Icon name="info" size={20} />
          <p>Nenhuma empresa disponível para acesso no momento.</p>
          <button onClick={() => void load()}>
            <Icon name="refresh" size={16} />
            Atualizar empresas
          </button>
        </div>
      )}
      <p className="small muted">Já tem o link da sua empresa? Acesse-o diretamente para entrar.</p>
    </section>
  );
}

function CompanyLogo({ name, src }: { name: string; src?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="company-option-logo" aria-hidden="true">
      {src && !failed ? (
        <img src={src} alt="" width="40" height="40" onError={() => setFailed(true)} />
      ) : (
        <span>{Array.from(name)[0]}</span>
      )}
    </span>
  );
}
