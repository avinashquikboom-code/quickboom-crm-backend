--
-- PostgreSQL database dump
--

\restrict EreSPUYTze7G7oACfOUjMz3tiE9QYxSc9PiiMSa3tfsxPjKf0lPeWrjEzlBTETG

-- Dumped from database version 18.6 (Homebrew)
-- Dumped by pg_dump version 18.6 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: crm_leads; Type: TABLE DATA; Schema: public; Owner: avinashsanjaymagar
--

INSERT INTO public.crm_leads (id, "companyName", "firstName", "lastName", phone, email, website, address, city, state, country, pincode, category, "googlePlaceId", latitude, longitude, source, "createdFrom", status, notes, "assignedToId", "createdById", "createdAt", "updatedAt", "deletedAt") VALUES (1, 'Apex Solar Systems 1792217867308', NULL, NULL, '+91 9876567308', 'contact@apexsolar1792217867308.com', 'https://apexsolar1792217867308.com', '456 Tech Horizon Park, Electronic City', 'Bengaluru', 'Karnataka', 'India', '560100', 'Solar Power Plant Equipment', 'ChIJ_APEX_SOLAR_1792217867308', 12.8452, 77.6602, 'DATA_CAPTURE', 'ADMIN_PANEL', 'NEW', NULL, NULL, 1, '2026-10-17 06:17:47.321', '2026-10-17 06:17:47.321', NULL);
INSERT INTO public.crm_leads (id, "companyName", "firstName", "lastName", phone, email, website, address, city, state, country, pincode, category, "googlePlaceId", latitude, longitude, source, "createdFrom", status, notes, "assignedToId", "createdById", "createdAt", "updatedAt", "deletedAt") VALUES (2, 'Mobile Capture Cafe 1792217875716', NULL, NULL, '+91 9999975716', 'cafe1792217875716@gmail.com', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ChIJ_MOBILE_1792217875716', NULL, NULL, 'DATA_CAPTURE', 'MOBILE_APP', 'NEW', NULL, 1, 2, '2026-10-17 06:17:55.722', '2026-10-17 06:17:55.722', NULL);
INSERT INTO public.crm_leads (id, "companyName", "firstName", "lastName", phone, email, website, address, city, state, country, pincode, category, "googlePlaceId", latitude, longitude, source, "createdFrom", status, notes, "assignedToId", "createdById", "createdAt", "updatedAt", "deletedAt") VALUES (3, 'Vadodara Elite Hotels', NULL, NULL, '+919810345678', 'info@vadodaraelitehotels.in', 'https://www.vadodaraelitehotels.in', '100, Near High Street, Vadodara', NULL, NULL, NULL, NULL, 'Hotels', 'ChIJc1bea3a957614744a6443e37', 22.3072, 73.1812, 'DATA_CAPTURE', 'ADMIN_PANEL', 'NEW', NULL, NULL, 1, '2026-10-17 08:41:33.528', '2026-10-17 08:41:33.528', NULL);


--
-- Name: crm_leads_id_seq; Type: SEQUENCE SET; Schema: public; Owner: avinashsanjaymagar
--

SELECT pg_catalog.setval('public.crm_leads_id_seq', 3, true);


--
-- PostgreSQL database dump complete
--

\unrestrict EreSPUYTze7G7oACfOUjMz3tiE9QYxSc9PiiMSa3tfsxPjKf0lPeWrjEzlBTETG

