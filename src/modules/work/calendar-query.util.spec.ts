import { parseCalendarMonthYear, workMatchesDesignation, workTypesForDesignation } from './calendar-query.util';

describe('workTypesForDesignation', () => {
  it('maps reel editor, video editor, shooter, and designer to their work types', () => {
    expect(workTypesForDesignation('Reel Editor')).toEqual(expect.arrayContaining(['EDITING', 'VIDEO_EDITING']));
    expect(workTypesForDesignation('Video Editor')).toEqual(expect.arrayContaining(['VIDEO_EDITING', 'EDITING']));
    expect(workTypesForDesignation('Reel Shooter')).toEqual(expect.arrayContaining(['SHOOT', 'REELS_SHOOT']));
    expect(workTypesForDesignation('Photographer')).toEqual(expect.arrayContaining(['SHOOT']));
    expect(workTypesForDesignation('Graphic Designer')).toEqual(expect.arrayContaining(['POST_DESIGN', 'GRAPHIC_DESIGN']));
    expect(workTypesForDesignation('Senior Photographer')).toEqual(expect.arrayContaining(['SHOOT', 'REELS_SHOOT']));
    expect(workTypesForDesignation('Social Media Manager')).toEqual(expect.arrayContaining(['UPLOADING']));
    expect(workTypesForDesignation('Production')).toEqual([]);
    expect(workTypesForDesignation('Telecaller')).toEqual([]);
  });

  it('matches stored work types and the calendar names for the same designation', () => {
    expect(workMatchesDesignation('Video Editor', 'EDITING')).toBe(true);
    expect(workMatchesDesignation('Video Editor', 'REEL_EDIT')).toBe(true);
    expect(workMatchesDesignation('Video Editor', 'SHOOT')).toBe(false);
    expect(workMatchesDesignation('Senior Photographer', 'SHOOT')).toBe(true);
    expect(workMatchesDesignation('Senior Photographer', 'REEL_SHOOT')).toBe(true);
    expect(workMatchesDesignation('Graphic Designer', 'STORY_DESIGN')).toBe(true);
    expect(workMatchesDesignation('Social Media Manager', 'UPLOADING')).toBe(true);
    expect(workMatchesDesignation('Social Media Manager', 'REEL_POST')).toBe(true);
    expect(workMatchesDesignation('Telecaller', 'EDITING')).toBe(false);
  });
});

describe('parseCalendarMonthYear', () => {
  it('parses month=10 and year=2026', () => {
    expect(parseCalendarMonthYear('10', '2026')).toEqual({ month: 10, year: 2026 });
  });

  it('parses month=2026-10', () => {
    expect(parseCalendarMonthYear('2026-10')).toEqual({ month: 10, year: 2026 });
  });

  it('rejects a year-month string parsed as a month number', () => {
    expect(parseCalendarMonthYear('2026-10', undefined).month).toBe(10);
    expect(parseCalendarMonthYear('2026')).toEqual({ month: undefined, year: undefined });
  });
});
