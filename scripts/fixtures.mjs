/**
 * Benchmark fixtures: synthetic screenshots that stand in for the kinds of
 * captures the extension receives. Each `draw` function is serialised into a
 * page with no CSP and rasterised at `width` x `height`, so it must be
 * self-contained (no imports, no outer variables).
 *
 * `phrases` are checked case-insensitively against the produced Markdown after
 * stripping punctuation. `checks` are regexes for structural output. `notes`
 * are quality-chip substrings the panel must show. `gated: false` marks a
 * fixture that is measured but not enforced — heavy blur is a known-weak area.
 */
export const FIXTURES = [
  {
    id: 'article',
    width: 760,
    height: 430,
    gated: true,
    phrases: [
      'Quarterly Summary',
      'Revenue grew by 18% in Q3, driven by enterprise accounts',
      'The team shipped four major releases this quarter',
      'Highlights',
      'Better reporting dashboard',
    ],
    checks: [
      ['heading', /^#{1,3} Quarterly Summary/m],
      ['list item', /^-\s+Better reporting dashboard/m],
    ],
    draw(ctx) {
      ctx.fillStyle = '#111111';
      ctx.font = '700 32px Arial';
      ctx.fillText('Quarterly Summary', 40, 30);
      ctx.font = '16px Arial';
      ctx.fillText('Revenue grew by 18% in Q3, driven by enterprise accounts.', 40, 92);
      ctx.fillText('The team shipped four major releases this quarter.', 40, 118);
      ctx.font = '700 20px Arial';
      ctx.fillText('Highlights', 40, 168);
      ctx.font = '16px Arial';
      const items = ['Faster onboarding flow', 'Better reporting dashboard', 'Three new integrations'];
      items.forEach((item, index) => {
        ctx.fillText('\u2022  ' + item, 56, 206 + index * 28);
      });
    },
  },
  {
    id: 'table',
    width: 720,
    height: 300,
    gated: true,
    phrases: ['Revenue by region', 'Region', 'North America', '$4.2M', 'Europe', '+11%'],
    checks: [
      ['table header', /\|\s*Region\s*\|\s*Revenue\s*\|\s*Growth\s*\|/],
      ['table row', /\|\s*Europe\s*\|\s*\$2\.8M\s*\|/],
    ],
    draw(ctx) {
      ctx.fillStyle = '#111111';
      ctx.font = '700 22px Arial';
      ctx.fillText('Revenue by region', 40, 28);

      const left = 40;
      const top = 84;
      const widths = [200, 160, 160];
      const rowHeight = 44;
      const rows = [
        ['Region', 'Revenue', 'Growth'],
        ['North America', '$4.2M', '+22%'],
        ['Europe', '$2.8M', '+11%'],
      ];
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 2;
      rows.forEach((row, rowIndex) => {
        let x = left;
        row.forEach((cell, columnIndex) => {
          ctx.font = rowIndex === 0 ? '700 16px Arial' : '16px Arial';
          ctx.fillText(cell, x + 12, top + rowIndex * rowHeight + 13);
          ctx.strokeRect(x, top + rowIndex * rowHeight, widths[columnIndex], rowHeight);
          x += widths[columnIndex];
        });
      });
    },
  },
  {
    id: 'table-gap',
    width: 620,
    height: 230,
    gated: true,
    phrases: ['Sprint board', 'Task', 'Owner', 'Status', 'Design review', 'Mira', 'Ship it'],
    checks: [
      ['table header', /\|\s*Task\s*\|\s*Owner\s*\|\s*Status\s*\|/],
      ['row with an empty cell', /\|\s*Design review\s*\|\s*Mira\s*\|/],
      ['last row kept', /\|\s*Ship it\s*\|\s*Dev\s*\|\s*Done\s*\|/],
    ],
    draw(ctx) {
      ctx.fillStyle = '#111111';
      ctx.font = '700 20px Arial';
      ctx.fillText('Sprint board', 36, 24);

      const left = 36;
      const top = 66;
      const widths = [250, 150, 120];
      const rowHeight = 42;
      const rows = [
        ['Task', 'Owner', 'Status'],
        ['Design review', 'Mira', ''],
        ['Ship it', 'Dev', 'Done'],
      ];
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 2;
      rows.forEach((row, rowIndex) => {
        let x = left;
        row.forEach((cell, columnIndex) => {
          ctx.fillStyle = rowIndex === 0 ? '#111111' : '#222222';
          ctx.font = rowIndex === 0 ? '700 15px Arial' : '15px Arial';
          if (cell) ctx.fillText(cell, x + 10, top + rowIndex * rowHeight + 12);
          ctx.strokeRect(x, top + rowIndex * rowHeight, widths[columnIndex], rowHeight);
          x += widths[columnIndex];
        });
      });
    },
  },
  {
    id: 'table-merged',
    width: 700,
    height: 290,
    gated: true,
    phrases: ['Sprint costs', 'Item', 'Quantity', 'Cost', 'Apples', 'Total', '9.00'],
    checks: [
      ['table header', /\|\s*Item\s*\|\s*Quantity\s*\|\s*Cost\s*\|/],
      ['row keeps its empty middle cell', /\|\s*Total\s*\|\s*\|\s*\$9\.00\s*\|/],
      ['last data row kept', /\|\s*Pears\s*\|\s*1\s*\|\s*\$3\.00\s*\|/],
    ],
    draw(ctx) {
      ctx.fillStyle = '#111111';
      ctx.font = '700 20px Arial';
      ctx.fillText('Sprint costs', 36, 24);

      const left = 36;
      const top = 72;
      const widths = [210, 170, 190];
      const rowHeight = 42;
      const rows = [
        ['Item', 'Quantity', 'Cost'],
        ['Apples', '2', '$6.00'],
        ['Pears', '1', '$3.00'],
        ['Total', '', '$9.00'],
      ];
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 2;
      rows.forEach((row, rowIndex) => {
        let x = left;
        row.forEach((cell, columnIndex) => {
          ctx.fillStyle = rowIndex === 0 ? '#111111' : '#222222';
          ctx.font = rowIndex === 0 ? '700 15px Arial' : '15px Arial';
          if (cell) ctx.fillText(cell, x + 10, top + rowIndex * rowHeight + 12);
          ctx.strokeRect(x, top + rowIndex * rowHeight, widths[columnIndex], rowHeight);
          x += widths[columnIndex];
        });
      });
    },
  },
  {
    id: 'form-fields',
    width: 560,
    height: 340,
    gated: true,
    phrases: ['Account details', 'Email', 'ada@example.com', 'Password', 'Team annual'],
    checks: [
      ['heading', /^#{1,3} Account details/m],
      ['first field', /^Email:\s+ada@example\.com$/m],
      ['last field', /^Plan:\s+Team annual$/m],
    ],
    draw(ctx) {
      ctx.fillStyle = '#111111';
      ctx.font = '700 24px Arial';
      ctx.fillText('Account details', 32, 24);

      const fields = [
        ['Email', 'ada@example.com'],
        ['Password', 'correct horse battery'],
        ['Plan', 'Team annual'],
      ];
      fields.forEach(([label, value], index) => {
        const y = 88 + index * 76;
        ctx.fillStyle = '#5b6472';
        ctx.font = '13px Arial';
        ctx.fillText(label, 32, y);
        ctx.fillStyle = '#111111';
        ctx.font = '16px Arial';
        ctx.fillText(value, 32, y + 20);
      });
    },
  },
  {
    id: 'sidebar',
    width: 760,
    height: 320,
    gated: true,
    phrases: ['Release notes', 'Owner', 'Ada Lovelace', 'The dashboard is ready for review'],
    checks: [
      ['sidebar field pair', /^Owner:\s+Ada Lovelace$/m],
      ['third sidebar field', /^Updated:\s+Today$/m],
      ['article heading', /^#{1,3} Release notes/m],
      ['article paragraph break', /editor\.\n\nThanks to everyone/m],
    ],
    draw(ctx) {
      ctx.fillStyle = '#111111';
      const rows = [
        ['Owner', 'Ada Lovelace'],
        ['Status', 'Active'],
        ['Updated', 'Today'],
      ];
      rows.forEach(([label, value], index) => {
        const y = 40 + index * 56;
        ctx.fillStyle = '#5b6472';
        ctx.font = '12px Arial';
        ctx.fillText(label, 32, y);
        ctx.fillStyle = '#111111';
        ctx.font = '14px Arial';
        ctx.fillText(value, 32, y + 18);
      });

      ctx.strokeStyle = '#d4d8e0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(210, 28);
      ctx.lineTo(210, 280);
      ctx.stroke();

      ctx.fillStyle = '#111111';
      ctx.font = '700 22px Arial';
      ctx.fillText('Release notes', 260, 34);
      ctx.font = '16px Arial';
      const body = [
        'The dashboard is ready for review.',
        'Export now includes the full history.',
        'Two small fixes landed for the editor.',
        'Thanks to everyone who filed a bug.',
      ];
      body.forEach((line, index) => ctx.fillText(line, 260, 92 + index * 30));
    },
  },
  {
    id: 'list',
    width: 660,
    height: 350,
    gated: true,
    phrases: [
      'Setup checklist',
      'Install the extension',
      'Enable developer mode',
      'Load the unpacked folder',
      'First step',
    ],
    checks: [
      ['bullet', /^-\s+Install the extension/m],
      ['numbered', /^1\.\s+First step/m],
    ],
    draw(ctx) {
      ctx.fillStyle = '#111111';
      ctx.font = '700 22px Arial';
      ctx.fillText('Setup checklist', 36, 26);

      ctx.font = '16px Arial';
      const bullets = ['Install the extension', 'Enable developer mode', 'Load the unpacked folder'];
      bullets.forEach((item, index) => {
        ctx.fillText('\u2022  ' + item, 52, 78 + index * 30);
      });

      ctx.font = '700 18px Arial';
      ctx.fillText('Steps', 36, 188);

      ctx.font = '16px Arial';
      const steps = ['First step', 'Second step', 'Third step'];
      steps.forEach((item, index) => {
        ctx.fillText(`${index + 1}.  ${item}`, 52, 226 + index * 30);
      });
    },
  },
  {
    id: 'nested-list',
    width: 560,
    height: 250,
    gated: true,
    phrases: [
      'Project setup',
      'Install dependencies',
      'Run the dev server',
      'Configure the editor',
      'Open the preview',
    ],
    checks: [
      ['top level bullet', /^-\s+Install dependencies/m],
      ['nested bullet', /^ {2,}-\s+Run the dev server/m],
      ['top level bullet 2', /^-\s+Open the preview/m],
    ],
    draw(ctx) {
      ctx.fillStyle = '#111111';
      ctx.font = '700 22px Arial';
      ctx.fillText('Project setup', 32, 24);

      ctx.font = '16px Arial';
      ctx.fillText('\u2022  Install dependencies', 48, 76);
      ctx.fillText('\u2022  Run the dev server', 86, 108);
      ctx.fillText('\u2022  Configure the editor', 86, 140);
      ctx.fillText('\u2022  Open the preview', 48, 180);
    },
  },
  {
    id: 'code-dark',
    width: 640,
    height: 230,
    background: '#1e1e1e',
    gated: true,
    phrases: ['function add(a, b)', 'return a + b', 'const total = add(2, 3)'],
    checks: [
      ['fence', /```/],
      ['indented body', /\n\s{2}return a \+ b;/],
    ],
    draw(ctx) {
      ctx.fillStyle = '#e8e8e8';
      ctx.font = '17px Consolas, monospace';
      ctx.fillText('function add(a, b) {', 36, 44);
      ctx.fillText('  return a + b;', 36, 82);
      ctx.fillText('}', 36, 120);
      ctx.fillText('const total = add(2, 3);', 36, 158);
    },
  },
  {
    id: 'ui-panel',
    width: 640,
    height: 330,
    background: '#2b303b',
    gated: true,
    phrases: ['Preferences', 'Compact output', 'Max image width', 'Show line numbers'],
    checks: [
      ['heading', /^#{1,3} Preferences/m],
      ['label/value pair', /^Compact output: On/m],
      ['label/value pair 2', /^Show line numbers: Off/m],
    ],
    draw(ctx) {
      ctx.fillStyle = '#9aa3b2';
      ctx.font = '700 22px Arial';
      ctx.fillText('Preferences', 32, 26);

      const rows = [
        ['Compact output', 'On'],
        ['Max image width', '2400 px'],
        ['Show line numbers', 'Off'],
      ];
      rows.forEach((row, index) => {
        const y = 86 + index * 56;
        ctx.fillStyle = '#6b7280';
        ctx.font = '16px Arial';
        ctx.fillText(row[0], 32, y);
        ctx.fillText(row[1], 390, y);
        ctx.strokeStyle = '#3d4450';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(32, y + 30);
        ctx.lineTo(608, y + 30);
        ctx.stroke();
      });
    },
  },
  {
    id: 'receipt',
    width: 380,
    height: 380,
    gated: true,
    phrases: ['BLUE BOTTLE', 'Coffee', '4.50', 'Sandwich', '9.75', 'Total', '24.50'],
    checks: [
      ['total row', /Total\s+24\.50/],
      ['item price pair', /^Coffee: 4\.50/mi],
    ],
    draw(ctx) {
      ctx.fillStyle = '#111111';
      ctx.font = '700 20px "Courier New", monospace';
      ctx.fillText('BLUE BOTTLE', 30, 28);

      const lines = [
        ['Coffee', '4.50'],
        ['Sandwich', '9.75'],
        ['Juice', '3.25'],
        ['Cookie', '2.00'],
        ['Tax', '5.00'],
      ];
      ctx.font = '15px "Courier New", monospace';
      lines.forEach((line, index) => {
        ctx.fillText(line[0], 30, 78 + index * 28);
        ctx.fillText(line[1], 286, 78 + index * 28);
      });

      ctx.font = '700 17px "Courier New", monospace';
      ctx.fillText('Total', 30, 268);
      ctx.fillText('24.50', 272, 268);
    },
  },
  {
    id: 'tiny-text',
    width: 620,
    height: 220,
    gated: true,
    phrases: [
      'Tiny text should still be readable after upscaling',
      'This line tests the crop upscaler at eleven pixels',
    ],
    checks: [],
    draw(ctx) {
      ctx.fillStyle = '#111111';
      ctx.font = '11px Arial';
      ctx.fillText('Tiny text should still be readable after upscaling.', 28, 40);
      ctx.fillText('This line tests the crop upscaler at eleven pixels.', 28, 64);
      ctx.fillText('A third line adds a little more body copy.', 28, 88);
    },
  },
  {
    id: 'low-contrast',
    width: 720,
    height: 210,
    background: '#d9d9d9',
    gated: true,
    phrases: ['Disabled settings', 'Grey text on grey needs rescue', 'Contrast equalisation'],
    notes: ['Low contrast boosted'],
    checks: [],
    draw(ctx) {
      ctx.fillStyle = '#a3a3a3';
      ctx.font = '700 24px Arial';
      ctx.fillText('Disabled settings', 34, 30);
      ctx.font = '17px Arial';
      ctx.fillText('Grey text on grey needs rescue.', 34, 92);
      ctx.fillText('Contrast equalisation should find it.', 34, 124);
    },
  },
  {
    id: 'two-column',
    width: 720,
    height: 260,
    gated: true,
    phrases: ['First column opens the story', 'Second column carries the'],
    checks: [
      ['column order', /^First column opens the story[\s\S]*Second column carries the/],
      ['separate paragraphs', /with three lines of text\n\nSecond column/],
    ],
    draw(ctx) {
      ctx.fillStyle = '#111111';
      ctx.font = '16px Arial';
      const left = [
        'First column opens the story',
        'and continues on this side',
        'with three lines of text',
      ];
      const right = [
        'Second column carries the',
        'rest of the article body',
        'and ends right here',
      ];
      left.forEach((line, index) => ctx.fillText(line, 32, 44 + index * 26));
      right.forEach((line, index) => ctx.fillText(line, 380, 44 + index * 26));
    },
  },
  {
    id: 'columns-table',
    width: 780,
    height: 390,
    gated: true,
    phrases: [
      'Launch plan',
      'Left column starts here',
      'Right column tells the story',
      'Task',
      'Owner',
      'Status',
      'Write brief',
      'Mira',
    ],
    checks: [
      ['heading first', /^#{1,3} Launch plan/m],
      ['column order', /Left column starts here[\s\S]*Right column tells the story/],
      ['table after columns', /Right column tells the story[\s\S]*\|\s*Task\s*\|\s*Owner\s*\|/],
      ['table row', /\|\s*Write brief\s*\|\s*Mira\s*\|\s*Done\s*\|/],
    ],
    draw(ctx) {
      ctx.fillStyle = '#111111';
      ctx.font = '700 22px Arial';
      ctx.fillText('Launch plan', 32, 28);

      ctx.font = '16px Arial';
      const left = [
        'Left column starts here and',
        'wraps onto another line for',
        'the opening paragraph',
      ];
      const right = [
        'Right column tells the story',
        'from the other side of the',
        'page without interruption',
      ];
      left.forEach((line, index) => ctx.fillText(line, 32, 76 + index * 26));
      right.forEach((line, index) => ctx.fillText(line, 400, 76 + index * 26));

      const tableLeft = 32;
      const tableTop = 228;
      const widths = [250, 170, 150];
      const rowHeight = 40;
      const rows = [
        ['Task', 'Owner', 'Status'],
        ['Write brief', 'Mira', 'Done'],
        ['Review copy', 'Dev', 'Open'],
      ];
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 2;
      rows.forEach((row, rowIndex) => {
        let x = tableLeft;
        row.forEach((cell, columnIndex) => {
          ctx.fillStyle = rowIndex === 0 ? '#111111' : '#222222';
          ctx.font = rowIndex === 0 ? '700 15px Arial' : '15px Arial';
          ctx.fillText(cell, x + 10, tableTop + rowIndex * rowHeight + 12);
          ctx.strokeRect(x, tableTop + rowIndex * rowHeight, widths[columnIndex], rowHeight);
          x += widths[columnIndex];
        });
      });
    },
  },
  {
    id: 'blurry',
    width: 780,
    height: 240,
    gated: false,
    phrases: ['Sharp text becomes soft'],
    notes: ['Soft capture'],
    checks: [],
    draw(ctx) {
      ctx.filter = 'blur(1.6px)';
      ctx.fillStyle = '#111111';
      ctx.font = '18px Arial';
      ctx.fillText('Sharp text becomes soft when captured badly.', 30, 44);
      ctx.fillText('A second line for the blur detector.', 30, 78);
      ctx.filter = 'none';
    },
  },
];
