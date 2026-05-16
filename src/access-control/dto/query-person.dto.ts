export class QueryPersonDto {
  search?: string;
  personType?: 'EMPLOYEE' | 'RESIDENT';
  isActive?: string;
  doorId?: string;
  doorIds?: string;
  page?: string;
  limit?: string;
}
