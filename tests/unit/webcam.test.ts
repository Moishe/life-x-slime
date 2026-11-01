import { describe, it, expect } from 'vitest';
import { webcamErrorText } from '../../src/ui/webcam';

const domError = (name: string) => Object.assign(new Error('browser detail'), { name });

describe('webcamErrorText', () => {
  it('explains a denied permission', () => {
    expect(webcamErrorText(domError('NotAllowedError'))).toBe('Camera access was denied.');
  });

  it('explains a missing camera', () => {
    expect(webcamErrorText(domError('NotFoundError'))).toBe('No camera was found.');
  });

  it('explains a camera that is already in use', () => {
    expect(webcamErrorText(domError('NotReadableError'))).toBe('The camera is in use by another app.');
  });

  it('passes other errors through with their message', () => {
    expect(webcamErrorText(new Error('boom'))).toBe('Could not open the camera: boom');
    expect(webcamErrorText('odd')).toBe('Could not open the camera: odd');
  });
});
