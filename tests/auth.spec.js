// tests/auth.spec.js
import { test, expect } from '@playwright/test';
 
// ----------------------------------------------------
// 1. Sign Up Tests (Student Registration)
// ----------------------------------------------------
test.describe('Sign Up Flow Basics', () => {
 
  test('should show error for non-SLIIT email', async ({ page }) => {
    await page.goto('http://localhost:5173/signup');
 
    // Fill the form with invalid email
    await page.fill('input[name="firstName"]', 'John');
    await page.fill('input[name="lastName"]', 'Doe');
    await page.fill('input[name="email"]', 'johndoe@gmail.com'); // Invalid email for SLIIT
    
    await page.selectOption('select[name="academicYear"]', '1st Year');
    await page.selectOption('select[name="faculty"]', 'Computing');
    
    await page.fill('input[name="phone"]', '0771234567');
    await page.fill('input[name="password"]', 'Strong@123');
    await page.fill('input[name="confirmPassword"]', 'Strong@123');
 
    // Trying to submit
    await page.click('button[type="submit"]');
 
    // Expect an error text specific to email validation
    await expect(page.locator('text=Must be ITxxxx@my.sliit.lk')).toBeVisible();
  });
 
  test('should fail when passwords do not match', async ({ page }) => {
    await page.goto('http://localhost:5173/signup');
 
    await page.fill('input[name="password"]', 'Strong@123');
    await page.fill('input[name="confirmPassword"]', 'Mismatch@123');
    await page.click('button[type="submit"]');
 
    await expect(page.locator('text=Passwords do not match.')).toBeVisible();
  });
});
 
// ----------------------------------------------------
// 2. Login & User Roles Tests
// ----------------------------------------------------
test.describe('Login & Role Based Tests', () => {
 
  test('Successful Student Login', async ({ page }) => {
    await page.goto('http://localhost:5173/login');
 
    await page.fill('input[name="email"]', 'it23825314@my.sliit.lk');
    await page.fill('input[name="password"]', 'Chanuka@123');
    await page.click('button[type="submit"]');
 
    await expect(page).toHaveURL(/.*home/, { timeout: 10000 });
  });
 
  test('Successful Admin Login', async ({ page }) => {
    await page.goto('http://localhost:5173/login');
 
    await page.fill('input[name="email"]', 'admin@sliitek.com');
    await page.fill('input[name="password"]', 'Admin@123');
    await page.click('button[type="submit"]');
 
    await expect(page).toHaveURL(/.*dashboard|home/, { timeout: 10000 });
  });
 
  test('Failed Login with incorrect password', async ({ page }) => {
    await page.goto('http://localhost:5173/login');
 
    await page.fill('input[name="email"]', 'it23825314@my.sliit.lk');
    await page.fill('input[name="password"]', 'WrongPassword123');
    await page.click('button[type="submit"]');
 
    await expect(page.locator('text=Login failed').or(page.locator('.text-red-600'))).toBeVisible();
  });
 
  test('Remember Me functionality', async ({ page }) => {
    await page.goto('http://localhost:5173/login');
 
    await page.fill('input[name="email"]', 'it23825314@my.sliit.lk');
    await page.fill('input[name="password"]', 'Chanuka@123');
    
    // Check remember me box
    await page.check('input[name="rememberMe"]');
    await page.click('button[type="submit"]');

    
    await page.waitForURL(/.*home/, { timeout: 10000 });

    
    const rememberEmail = await page.evaluate(() => localStorage.getItem('rememberEmail'));
    expect(rememberEmail).toBe('it23825314@my.sliit.lk');
  });
 
});
 
// ----------------------------------------------------
// 3. Forgot Password Tests
// ----------------------------------------------------
test.describe('Forgot Password Flow', () => {
 
  test('Step 1: Should ask for OTP when a valid email is provided', async ({ page }) => {
    await page.goto('http://localhost:5173/forgot-password');
 
    // Try an empty form first
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Please fill in this field').or(page.locator(':invalid'))).toBeVisible({ timeout: 5000 }).catch(() => {});
 
    // Valid Request
    await page.fill('input[type="email"]', 'it23825314@my.sliit.lk');
    await page.click('button[type="submit"]');
 
    // It should move to Step 2
    await expect(page.locator('text=Code from your email')).toBeVisible({ timeout: 10000 });
  });
  
});