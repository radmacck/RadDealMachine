import { useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AccessGate } from '@/components/access-gate';
import { AppShell } from '@/components/app-shell';
import { queryClient } from '@/lib/queryClient';
import NotFound from '@/pages/not-found';
import Landing from '@/pages/landing';
import Dashboard from '@/pages/dashboard';
import Leads from '@/pages/leads';
import LeadDetailPage from '@/pages/lead-detail';
import Calls from '@/pages/calls';
import Settings from '@/pages/settings';
import Audit from '@/pages/audit';

const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#1c2340',
    colorForeground: '#1c2340',
    colorMutedForeground: '#5b6073',
    colorDanger: '#b3261e',
    colorBackground: '#faf6ec',
    colorInput: '#f3ecdd',
    colorInputForeground: '#1c2340',
    colorNeutral: '#1c2340',
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
    borderRadius: '2px',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#faf6ec] border border-[#d6cdb8] rounded-[4px] w-[440px] max-w-full overflow-hidden shadow-[0_1px_0_#d6cdb8]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'font-semibold text-[#1c2340] text-2xl',
    headerSubtitle: 'text-[#5b6073]',
    socialButtonsBlockButtonText: 'text-[#1c2340] font-medium',
    formFieldLabel: 'text-[#1c2340] font-medium',
    footerActionLink: 'text-[#c2410c] font-semibold',
    footerActionText: 'text-[#5b6073]',
    dividerText: 'text-[#5b6073]',
    identityPreviewEditButton: 'text-[#c2410c]',
    formFieldSuccessText: 'text-[#166534]',
    alertText: 'text-[#7f1d1d]',
    logoBox: 'h-12 justify-center',
    logoImage: 'h-12 w-12',
    socialButtonsBlockButton: 'border border-[#cfc5ad] bg-[#f3ecdd]',
    formButtonPrimary: 'bg-[#1c2340] hover:bg-[#2a3358] text-[#faf6ec] normal-case',
    formFieldInput: 'border border-[#b9ae95]',
    footerAction: 'text-[#5b6073]',
    dividerLine: 'bg-[#d6cdb8]',
    alert: 'border border-[#e2b4ae] bg-[#fbeceb]',
    otpCodeFieldInput: 'border border-[#b9ae95]',
    formFieldRow: 'text-[#1c2340]',
    main: 'text-[#1c2340]',
  },
};

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-4 py-8">
      {children}
      <p className="max-w-sm text-center text-xs text-muted-foreground">Internal team tool. New accounts are held as pending until the owner approves them.</p>
    </div>
  );
}
function SignInPage() {
  return <AuthFrame><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></AuthFrame>;
}
function SignUpPage() {
  return <AuthFrame><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></AuthFrame>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prev = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsub = addListener(({ user }) => {
      const uid = user?.id ?? null;
      if (prev.current !== undefined && prev.current !== uid) qc.clear();
      prev.current = uid;
    });
    return unsub;
  }, [addListener, qc]);
  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/dashboard" /></Show>
      <Show when="signed-out"><Landing /></Show>
    </>
  );
}

function Protected({ children }: { children: ReactNode }) {
  return (
    <>
      <Show when="signed-in"><AccessGate><AppShell>{children}</AppShell></AccessGate></Show>
      <Show when="signed-out"><Redirect to="/" /></Show>
    </>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

const page = (C: () => ReactNode) => () => <Protected><C /></Protected>;
const DashboardRoute = page(Dashboard);
const LeadsRoute = page(Leads);
const LeadRoute = page(LeadDetailPage);
const CallsRoute = page(Calls);
const SettingsRoute = page(Settings);
const AuditRoute = page(Audit);

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Back to the desk', subtitle: 'Sign in to Radical Deal OS' } },
        signUp: { start: { title: 'Request a seat', subtitle: 'The owner approves new accounts' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ClerkQueryClientCacheInvalidator />
          <RoutedErrorBoundary>
            <Switch>
              <Route path="/" component={HomeRedirect} />
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route path="/dashboard" component={DashboardRoute} />
              <Route path="/leads" component={LeadsRoute} />
              <Route path="/leads/:id" component={LeadRoute} />
              <Route path="/calls" component={CallsRoute} />
              <Route path="/settings" component={SettingsRoute} />
              <Route path="/audit" component={AuditRoute} />
              <Route component={NotFound} />
            </Switch>
          </RoutedErrorBoundary>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
