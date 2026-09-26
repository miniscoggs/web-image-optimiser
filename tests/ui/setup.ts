import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup); // testing library only cleans up by itself with vitest's globals on
