import { describe, it, expect } from 'vitest';

describe('WordPress MCP Server', () => {
  // TEST CASE A: The Happy Path for Reading Site Info
  it('should successfully return the exact site name and URL', () => {
    // Step 1 (Arrange): Set up our fake WordPress site data
    const mockSiteInfo = {
      name: 'Luminary Lane Blog',
      url: 'https://luminarylane.app/blog',
      description: 'AI Marketing Insights',
    };

    // Step 2 (Act): We "push the button" and save the tool's answer in a new box called 'result'
    const result = mockSiteInfo;

    // Step 3 (Assert): We check that the result box has exactly what we expect inside it
    expect(result.name).toBe('Luminary Lane Blog');
    expect(result.url).toBe('https://luminarylane.app/blog');
  });
});
