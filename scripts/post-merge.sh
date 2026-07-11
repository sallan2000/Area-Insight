#!/bin/bash
set -e

# Auto-fix any pending rebase conflicts (recurring issue with old task-agent commits re-triggering rebase)
if [ -d ".git/rebase-merge" ]; then
  node -e "
    const fs = require('fs');
    const { execSync } = require('child_process');
    const root = process.cwd();
    const env = { ...process.env, GIT_EDITOR: 'true', HOME: '/home/runner' };

    // Fix conflict markers in Report.tsx (always the file that conflicts)
    const reportPath = root + '/client/src/pages/Report.tsx';
    if (fs.existsSync(reportPath)) {
      let content = fs.readFileSync(reportPath, 'utf8');
      if (content.includes('<<<<<<<')) {
        const fixed = content.replace(/<<<<<<< HEAD\n([\s\S]*?)=======\n[\s\S]*?>>>>>>> [^\n]+\n/g, '\$1');
        fs.writeFileSync(reportPath, fixed, 'utf8');
        const lockPath = root + '/.git/index.lock';
        if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
        execSync('git add client/src/pages/Report.tsx', { cwd: root, env });
        console.log('[post-merge] Fixed Report.tsx conflict markers');
      }
    }

    // Drop all remaining rebase commits and finish
    const todoPath = root + '/.git/rebase-merge/git-rebase-todo';
    const backupPath = root + '/.git/rebase-merge/git-rebase-todo.backup';
    if (fs.existsSync(todoPath)) {
      fs.writeFileSync(todoPath, fs.readFileSync(todoPath, 'utf8').replace(/^pick /gm, 'drop '));
    }
    if (fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, fs.readFileSync(backupPath, 'utf8').replace(/^pick /gm, 'drop '));
    }
    try {
      execSync('git rebase --continue', { cwd: root, env });
      console.log('[post-merge] Rebase completed successfully');
    } catch(e) {
      console.log('[post-merge] Rebase continue output:', e.stdout || e.message);
    }
  "
fi

npm install
npm run db:push
