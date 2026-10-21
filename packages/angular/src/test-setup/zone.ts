import '@angular/compiler';
import { NgModule, provideZoneChangeDetection } from '@angular/core';
import { ComponentFixtureAutoDetect, getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

// Vitest's AbortSignal is Node's; zone.js calls jsdom's addEventListener on it, so route that to Node's.
const domAdd = EventTarget.prototype.addEventListener;
const nodeTarget: EventTarget = Object.getPrototypeOf(AbortSignal.prototype);
EventTarget.prototype.addEventListener = function (this: EventTarget, ...args) {
  return (this instanceof EventTarget ? domAdd : nodeTarget.addEventListener).apply(this, args);
};
await import('zone.js');

@NgModule({
  providers: [
    provideZoneChangeDetection(),
    { provide: ComponentFixtureAutoDetect, useValue: true },
  ],
})
class ZoneModule {}

getTestBed().initTestEnvironment([BrowserTestingModule, ZoneModule], platformBrowserTesting());
