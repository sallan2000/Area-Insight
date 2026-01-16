import { useMutation, useQuery } from "@tanstack/react-query";
import { api, buildUrl, type AssessInput } from "@shared/routes";
import { useLocation } from "wouter";

// Create a new assessment
export function useCreateAssessment() {
  const [, setLocation] = useLocation();
  
  return useMutation({
    mutationFn: async (data: AssessInput) => {
      // Validate locally first (optional but good practice)
      const validated = api.assess.create.input.parse(data);
      
      const res = await fetch(api.assess.create.path, {
        method: api.assess.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
      });

      if (!res.ok) {
        if (res.status === 400) {
          const error = api.assess.create.responses[400].parse(await res.json());
          throw new Error(error.message);
        }
        throw new Error("Failed to create assessment");
      }

      return api.assess.create.responses[201].parse(await res.json());
    },
    onSuccess: (data) => {
      // Navigate to results page
      setLocation(`/report/${data.id}`);
    },
  });
}

// Fetch a specific assessment by ID
export function useAssessment(id: number) {
  return useQuery({
    queryKey: [api.assess.get.path, id],
    queryFn: async () => {
      if (!id) throw new Error("ID is required");
      
      const url = buildUrl(api.assess.get.path, { id });
      const res = await fetch(url);
      
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch assessment");
      
      return api.assess.get.responses[200].parse(await res.json());
    },
    enabled: !!id && !isNaN(id),
  });
}
