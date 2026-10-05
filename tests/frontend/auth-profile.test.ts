import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRegisterPayload, getProfileDisplayName, getProfileInitial, passwordsMatch, validateDisplayName } from '../../src/utils/profile.ts';

describe('signup and profile display helpers', () => {
  it('trims display names and validates required and maximum length', () => {
    assert.equal(validateDisplayName('  Saran  '), null);
    assert.equal(validateDisplayName('  '), 'Display name is required.');
    assert.equal(validateDisplayName('x'.repeat(51)), 'Display name must be 50 characters or fewer.');
    assert.equal(validateDisplayName('😀'.repeat(50)), null);
  });

  it('compares password confirmation without including it in signup data', () => {
    assert.equal(passwordsMatch('correct horse', 'correct horse'), true);
    assert.equal(passwordsMatch('correct horse', 'different'), false);
    assert.deepEqual(createRegisterPayload('  Saran  ', ' saran@example.com ', 'correct horse'), {
      displayName: 'Saran', email: 'saran@example.com', password: 'correct horse'
    });
    assert.deepEqual(Object.keys(createRegisterPayload('Saran', 'saran@example.com', 'correct horse')).sort(), ['displayName', 'email', 'password']);
  });

  it('uses the first uppercase display-name character for the avatar', () => {
    assert.equal(getProfileInitial({ displayName: 'Saran', email: 'saran@example.com' }), 'S');
    assert.equal(getProfileInitial({ displayName: 'Akshat Saxena', email: 'akshat@example.com' }), 'A');
  });

  it('falls back to the email prefix for existing users without a display name', () => {
    const identity = { displayName: null, name: 'Old Name', email: 'legacy@example.com' };
    assert.equal(getProfileDisplayName(identity), 'legacy');
    assert.equal(getProfileInitial(identity), 'L');
  });
});
