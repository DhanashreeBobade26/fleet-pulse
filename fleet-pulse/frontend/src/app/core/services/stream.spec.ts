import { TestBed } from '@angular/core/testing';

import { Stream } from './stream';

describe('Stream', () => {
  let service: Stream;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Stream);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
