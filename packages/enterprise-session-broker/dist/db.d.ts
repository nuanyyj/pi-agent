export interface EnterpriseQueryResult<T> {
    rows: T[];
}
export interface EnterpriseTransaction {
    query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<EnterpriseQueryResult<T>>;
}
export interface EnterpriseDatabase {
    query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<EnterpriseQueryResult<T>>;
    transaction<T>(fn: (tx: EnterpriseTransaction) => Promise<T>): Promise<T>;
    withOrganization<T>(organizationId: string, fn: (tx: EnterpriseTransaction) => Promise<T>): Promise<T>;
    close(): Promise<void>;
}
export declare function createEnterpriseDatabase(connectionString: string): Promise<EnterpriseDatabase>;
