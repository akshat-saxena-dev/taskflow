import { useState, useEffect } from 'react';
import { Navigation, type NavPage } from './components/Navigation';
import { DashboardPage } from './pages/DashboardPage';
import { JobsPage } from './pages/JobsPage';
import { JobDetailsPage } from './pages/JobDetailsPage';
import { QueueStatsPage } from './pages/QueueStatsPage';
import { AuthPage } from './pages/AuthPage';
import { AuthProvider } from './context/AuthProvider';
import { useAuth } from './context/useAuth';
import { LoadingState } from './components/LoadingState';

const MainLayout: React.FC = () => {
  const { user, loading, logout } = useAuth();
  const [currentPage, setCurrentPage] = useState<NavPage>('dashboard');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [previousPage, setPreviousPage] = useState<NavPage>('dashboard');

  // Sync hash routing on initial load and hashchange
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#\/?/, '');
      if (hash.startsWith('jobs/')) {
        const id = hash.replace('jobs/', '');
        setSelectedJobId(id);
        setCurrentPage('job-details');
      } else if (hash === 'jobs') {
        setCurrentPage('jobs');
        setSelectedJobId(null);
      } else if (hash === 'queue-stats') {
        setCurrentPage('queue-stats');
        setSelectedJobId(null);
      } else if (hash === 'auth') {
        setCurrentPage('auth');
        setSelectedJobId(null);
      } else {
        setCurrentPage('dashboard');
        setSelectedJobId(null);
      }
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigateTo = (page: NavPage) => {
    if (page === currentPage) return;
    setPreviousPage(currentPage === 'job-details' ? previousPage : currentPage);
    setCurrentPage(page);

    if (page === 'dashboard') {
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

  // If unauthenticated, redirect protected views to AuthPage
  const isAuthView = currentPage === 'auth' || !user;

  return (
    <div>
      <Navigation
        activePage={isAuthView ? 'auth' : currentPage}
        onNavigate={navigateTo}
        selectedJobId={selectedJobId}
        user={user}
        onLogout={handleLogout}
      />
      <main className="tf-main-content">
        {isAuthView ? (
          <AuthPage onSuccess={() => navigateTo('dashboard')} />
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
