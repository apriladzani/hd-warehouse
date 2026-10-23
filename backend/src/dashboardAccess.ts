export type DashboardRole = 'WAREHOUSE' | 'FINANCE';

export function canAccessDashboard(role: string | undefined, dashboardRole: DashboardRole): boolean {
  return role?.toUpperCase() === dashboardRole;
}

export function canReadFinanceDashboard(role: string | undefined): boolean {
  const normalizedRole = role?.toUpperCase();
  return normalizedRole === 'WAREHOUSE' || normalizedRole === 'FINANCE';
}
