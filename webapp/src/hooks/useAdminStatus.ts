import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSettings } from '../context/SettingsContext';
import { useAdminApi } from '../api/admin';

export function useAdminStatus() {
  const { setAdminToken, logoutAdmin } = useSettings();
  const adminApi = useAdminApi();
  const queryClient = useQueryClient();

  // Always fetch admin status from server - single source of truth
  const { data: adminStatus, isLoading } = useQuery({
    queryKey: ['admin-status'],
    queryFn: adminApi.fetchStatus,
    staleTime: 0, // Always fetch fresh data
    refetchOnWindowFocus: true,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const adminModeEnabled = adminStatus?.enabled ?? false;

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: (password: string) => adminApi.enable(password),
    onSuccess: (data) => {
      setAdminToken(data.token);
      queryClient.invalidateQueries({ queryKey: ['admin-status'] });
    },
  });

  // Disable admin mode mutation
  const disableMutation = useMutation({
    mutationFn: () => adminApi.disable(),
    onSuccess: () => {
      logoutAdmin();
      queryClient.invalidateQueries({ queryKey: ['admin-status'] });
    },
  });

  // Logout (just clear token, don't disable)
  const logout = () => {
    logoutAdmin();
  };

  return {
    adminModeEnabled,
    isLoading,
    login: loginMutation.mutate,
    disable: disableMutation.mutate,
    logout,
    isLoginPending: loginMutation.isPending,
    isDisablePending: disableMutation.isPending,
  };
}
