import { useState, useEffect } from 'react';
import { Navigation, type NavPage } from './components/Navigation';
import { DashboardPage } from './pages/DashboardPage';
import { JobsPage } from './pages/JobsPage';
import { JobDetailsPage } from './pages/JobDetailsPage';
import { QueueStatsPage } from './pages/QueueStatsPage';
import { AuthPage } from './pages/AuthPage';
import { LandingPage } from './pages/LandingPage';
import { AuthProvider } from './context/AuthProvider';
import { useAuth } from './context/useAuth';
import { LoadingState } from './components/LoadingState';

const MainLayout: React.FC = () => {
  const { user, loading, logout } = useAuth();
  const [currentPage, setCurrentPage] = useState<NavPage>('landing');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [previousPage, setPreviousPage] = useState<NavPage>('dashboard');

  // Resolve the existing hash routes after session lookup, with a public root
  // experience for signed-out visitors.
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, '');
      if (hash.startsWith('jobs/')) {
        if (!user) {
          setCurrentPage('landing');
          setSelectedJobId(null);
          return;
        }
        const id = hash.replace('jobs/', '');
        setSelectedJobId(id);
        setCurrentPage('job-details');
      } else if (hash === 'jobs') {
        setCurrentPage(user ? 'jobs' : 'landing');
        setSelectedJobId(null);
      } else if (hash === 'queue-stats') {
        setCurrentPage(user ? 'queue-stats' : 'landing');
        setSelectedJobId(null);
      } else if (hash === 'auth' || hash === 'login') {
        setCurrentPage('auth');
        setSelectedJobId(null);
      } else if (hash === 'signup' || hash === 'register') {
        setCurrentPage('register');
        setSelectedJobId(null);
      } else if (hash === 'dashboard') {
        setCurrentPage(user ? 'dashboard' : 'landing');
        setSelectedJobId(null);
      } else {
        setCurrentPage(user ? 'dashboard' : 'landing');
        setSelectedJobId(null);
      }
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [user]);

  const navigateTo = (page: NavPage) => {
    if (page === currentPage) return;
    setPreviousPage(currentPage === 'job-details' ? previousPage : currentPage);
    setCurrentPage(page);

    if (page === 'landing') {
      window.location.hash = '#/';
      setSelectedJobId(null);
    } else if (page === 'dashboard') {
      window.location.hash = '#/dashboard';
      setSelectedJobId(null);
    } else if (page === 'jobs') {
      window.location.hash = '#/jobs';
      setSelectedJobId(null);
    } else if (page === 'queue-stats') {
      window.location.hash = '#/queue-stats';
      setSelectedJobId(null);
    } else if (page === 'auth') {
      window.location.hash = '#/auth';
      setSelectedJobId(null);
    } else if (page === 'register') {
      window.location.hash = '#/signup';
      setSelectedJobId(null);
    }
  };

  const handleSelectJob = (jobId: string) => {
    setPreviousPage(currentPage === 'job-details' ? previousPage : currentPage);
    setSelectedJobId(jobId);
    setCurrentPage('job-details');
    window.location.hash = `#/jobs/${jobId}`;
  };

  const handleBackFromDetails = () => {
    const target = previousPage === 'dashboard' ? 'dashboard' : 'jobs';
    navigateTo(target);
  };

  const handleLogout = async () => {
    await logout();
    navigateTo('auth');
  };

  if (loading) {
    return (
      <div style={{ padding: '60px 0' }}>
        <LoadingState message="Verifying authentication session..." />
      </div>
    );
  }

  const isAuthView = currentPage === 'auth' || currentPage === 'register';
  const isLandingView = !user && !isAuthView;

  return (
    <div>
      <Navigation
        activePage={currentPage}
        onNavigate={navigateTo}
        user={user}
        onLogout={handleLogout}
      />
      <main className="tf-main-content">
        {isLandingView ? (
          <LandingPage onLogin={() => navigateTo('auth')} onRegister={() => navigateTo('register')} />
        ) : isAuthView ? (
          <AuthPage initialMode={currentPage === 'register' ? 'register' : 'login'} onSuccess={() => navigateTo('dashboard')} />
        ) : (
          <>
            {currentPage === 'dashboard' && (
              <DashboardPage
                onSelectJob={handleSelectJob}
                onNavigateToJobs={() => navigateTo('jobs')}
              />
            )}

            {currentPage === 'jobs' && (
              <JobsPage onSelectJob={handleSelectJob} />
            )}

            {currentPage === 'job-details' && selectedJobId && (
              <JobDetailsPage
                key={selectedJobId}
                jobId={selectedJobId}
                onBack={handleBackFromDetails}
              />
            )}

            {currentPage === 'queue-stats' && <QueueStatsPage />}
          </>
        )}
      </main>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <MainLayout />
    </AuthProvider>
  );
};

export default App;
