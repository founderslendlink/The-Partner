'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { createClient } from './supabase';

export interface Business {
  id: string;
  name: string;
  mode: string;
  operator_mode: string;
  timezone: string;
}

const BusinessContext = createContext<Business | null>(null);

export function BusinessProvider({ children }: { children: ReactNode }) {
  const [business, setBusiness] = useState<Business | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from('businesses')
      .select('id,name,mode,operator_mode,timezone')
      .eq('active', true)
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) setBusiness(data as Business);
      });
  }, []);

  return (
    <BusinessContext.Provider value={business}>
      {children}
    </BusinessContext.Provider>
  );
}

export const useBusiness = () => useContext(BusinessContext);
