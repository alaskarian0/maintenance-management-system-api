export class QueryPersonDto {
  search?: string;
  personType?: 'EMPLOYEE' | 'RESIDENT';
  isActive?: string;
  page?: string;
  limit?: string;
}
