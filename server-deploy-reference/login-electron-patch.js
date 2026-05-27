// ============================================================
// REFERÊNCIA: Patch para Login.tsx no servidor VPS
// ============================================================
// DEPLOY: Adicionar este trecho ao Login.tsx existente em
//   /home/claude/Ana-Food/src/pages/Login.tsx
// ============================================================

// ─── 1. DECLARAÇÃO DE TIPO (no topo do arquivo) ────────────────

// Adicionar ANTES dos imports ou num arquivo .d.ts:
/*
declare global {
  interface Window {
    electronBridge?: {
      isElectron: boolean;
      version: string;
      loginSuccess: (data: ElectronLoginPayload) => void;
      logout: () => void;
      on: (channel: string, callback: (...args: any[]) => void) => void;
    };
  }
}

interface ElectronLoginPayload {
  userId: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  companyId: string;
  companyName: string;
  companyPhone?: string;
  companySubdomain?: string;
  role: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}
*/

// ─── 2. HELPER FUNCTION (adicionar no componente Login) ─────────

/*
// Detecta se está rodando dentro do Electron
const isElectron = (): boolean => {
  return !!(window as any).electronBridge?.isElectron;
};
*/

// ─── 3. CÓDIGO A ADICIONAR APÓS LOGIN BEM-SUCEDIDO ─────────────

// Dentro da função de handleLogin, APÓS o checkUserRole() retornar
// e a empresa/role serem resolvidos, adicionar:

/*
  // ========== PATCH ELECTRON ==========
  // Envia dados de sessão para o Electron Desktop App
  if (isElectron() && window.electronBridge) {
    const electronPayload: ElectronLoginPayload = {
      userId: authData.user.id,
      email: authData.user.email || '',
      accessToken: authData.session.access_token,
      refreshToken: authData.session.refresh_token,
      companyId: resolvedCompanyId,      // de profiles.company_id ou user_roles
      companyName: resolvedCompanyName,   // de companies.fantasy_name (join)
      companyPhone: resolvedCompanyPhone || '',
      companySubdomain: resolvedCompanySubdomain || '',
      role: resolvedRole,                // de user_roles (super_admin, company_staff, etc)
      supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
      supabaseAnonKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    };

    console.log('[Login] Enviando dados para Electron:', electronPayload.email);
    window.electronBridge.loginSuccess(electronPayload);
    
    // Não navegar para outra rota — o Electron controla a view
    return;
  }
  // ========== FIM PATCH ELECTRON ==========
*/

// ─── 4. INDICADOR VISUAL (opcional) ────────────────────────────

// Adicionar no JSX do formulário de login, por exemplo antes do botão:

/*
  {isElectron() && (
    <div style={{ 
      textAlign: 'center', 
      color: '#888', 
      fontSize: '12px', 
      marginBottom: '8px' 
    }}>
      🖥️ Modo Desktop v{window.electronBridge?.version}
    </div>
  )}
*/

// ─── 5. LOGOUT VIA ELECTRON ────────────────────────────────────

// Se o Electron enviar evento de logout, a página deve reagir:

/*
  useEffect(() => {
    if (isElectron() && window.electronBridge) {
      window.electronBridge.on('merchant-logged-out', () => {
        // Limpar state local, mostrar formulário de login novamente
        setUser(null);
        setError(null);
      });
    }
  }, []);
*/
