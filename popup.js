document.addEventListener('DOMContentLoaded', function() {
    // Get tabId from URL query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const tabId = parseInt(urlParams.get('tabId'));

    // Use chrome.tabs.get to get the tab information with the specific tabId
    chrome.tabs.get(tabId, function(currentTab) {
        var actionButton = document.getElementById('actionButton');
        var downloadCsvButton = document.getElementById('downloadCsvButton');
        var resultsTable = document.getElementById('resultsTable');
        var filenameInput = document.getElementById('filenameInput');

        if (currentTab && currentTab.url.includes("://www.google.com/maps/search")) {
            document.getElementById('message').textContent = "Let's scrape Google Maps!";
            actionButton.disabled = false;
            actionButton.classList.add('enabled');
        } else {
            var messageElement = document.getElementById('message');
            messageElement.innerHTML = '';
            var linkElement = document.createElement('a');
            linkElement.href = 'https://www.google.com/maps/search/';
            linkElement.textContent = "Go to Google Maps Search.";
            linkElement.target = '_blank'; 
            messageElement.appendChild(linkElement);

            actionButton.style.display = 'none'; 
            downloadCsvButton.style.display = 'none';
            filenameInput.style.display = 'none'; 
        }

        actionButton.addEventListener('click', function() {
            actionButton.disabled = true; // Disable button during scrape
            actionButton.textContent = "Scraping...";
            resultsTable.innerHTML = ''; // Clear previous results

            chrome.scripting.executeScript({
                target: {tabId: currentTab.id},
                function: scrollAndScrapeRepeatedly // Execute the new main scraping function
            }, function(injectionResults) {
                // Re-enable button and reset text
                actionButton.disabled = false;
                actionButton.textContent = "Scrape Again";

                if (chrome.runtime.lastError) {
                    console.error("Script injection failed: " + chrome.runtime.lastError.message);
                    document.getElementById('message').textContent = "Error during scraping. Check console.";
                    return;
                }
                
                const allScrapedData = injectionResults[0].result;
                if (!allScrapedData || allScrapedData.length === 0) {
                    document.getElementById('message').textContent = "No data scraped. Try a different search or scroll manually first.";
                    return;
                }

                // Filter out records without websites
                const filteredData = allScrapedData.filter(item => item.companyUrl);

                if (filteredData.length === 0) {
                    document.getElementById('message').textContent = "No businesses with websites found. Try a different search.";
                    return;
                }

                // Define and add headers to the table
                const headers = ['Title', 'Phone', 'Industry', 'City/Country', 'Website', 'Google Maps Link'];
                const headerRow = document.createElement('tr');
                headers.forEach(headerText => {
                    const header = document.createElement('th');
                    header.textContent = headerText;
                    headerRow.appendChild(header);
                });
                resultsTable.appendChild(headerRow);

                // Add new results to the table
                filteredData.forEach(function(item) {
                    var row = document.createElement('tr');
                    ['title', 'phone', 'industry', 'cityCountry', 'companyUrl', 'href'].forEach(function(key) {
                        var cell = document.createElement('td');
                        cell.textContent = item[key] || ''; 
                        row.appendChild(cell);
                    });
                    resultsTable.appendChild(row);
                });

                if (filteredData.length > 0) {
                    downloadCsvButton.disabled = false;
                    document.getElementById('message').textContent = `Scraped ${filteredData.length} items with websites (filtered from ${allScrapedData.length} total items).`;
                } else {
                    document.getElementById('message').textContent = "No items found or page structure changed.";
                }
            });
        });

        downloadCsvButton.addEventListener('click', function() {
            var csv = tableToCsv(resultsTable); 
            var filename = filenameInput.value.trim();
            if (!filename) {
                filename = 'google-maps-data.csv'; 
            } else {
                filename = filename.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.csv';
            }
            downloadCsv(csv, filename); 
        });

    });
});

// This function will be injected into the target page
async function scrollAndScrapeRepeatedly() {
    const MAX_SCROLLS = 8; // Reduced for faster completion
    const SCROLL_DELAY = 1500; // Reduced delay for faster scrolling
    const NO_NEW_CONTENT_LIMIT = 2; // Keep efficient
    const MAX_ITEMS_LIMIT = 50; // Optimized limit for speed

    let allItems = [];
    let noNewContentCount = 0;
    let scrollAttempts = 0;
    let scrapedItemIdentifiers = new Set(); // To track unique items

    // Function to extract website URL by clicking on place and reading side panel
    async function extractWebsiteFromPlace(container) {
        try {
            // Get the business title for validation
            const titleElement = container.querySelector('.qBF1Pd.fontHeadlineSmall');
            const businessTitle = titleElement ? titleElement.textContent.trim() : '';
            
            // Find the clickable link for this place
            const placeLink = container.querySelector('a.hfpxzc');
            if (!placeLink) return '';

            // Click on the place to load its details - no initial clearing needed
            placeLink.click();
            
            // Shorter initial wait for faster processing
            await wait(1500);
            
            // Quick validation and extraction approach
            let websiteUrl = '';
            let attempts = 0;
            const maxAttempts = 2; // Reduced from 3 to 2 for speed
            
            // Fast website extraction with multiple selectors in priority order
            const websiteSelectors = [
                'a.CsEnBe[aria-label*="Website"]',
                'a[aria-label*="Website:"]'
            ];
            
            for (let selector of websiteSelectors) {
                const elements = document.querySelectorAll(selector);
                
                for (let element of elements) {
                    const url = element.href || element.getAttribute('data-value');
                    if (url && isValidWebsiteUrl(url)) {
                        // Quick context validation - check if the element is in an active side panel
                        const container = element.closest('[role="main"]') || 
                                        element.closest('.m6QErb');
                        
                        if (container) {
                            // Quick title match - just check if the business name appears anywhere in the container
                            const containerText = container.textContent || '';
                            const titleWords = businessTitle.toLowerCase().split(' ').filter(word => word.length > 2);
                            
                            if (titleWords.length === 0 || titleWords.some(word => containerText.toLowerCase().includes(word))) {
                                websiteUrl = url;
                                console.log(`⚡ Found official website for ${businessTitle}: ${url}`);
                                return websiteUrl;
                            }
                        }
                    }
                }
            }
            
            // If not found, quick retry
            if (!websiteUrl && attempts < maxAttempts - 1) {
                placeLink.click();
                await wait(1000); // Shorter retry wait
            }
            attempts++;
            
            if (!websiteUrl) {
                console.log(`❌ No official website found for ${businessTitle}`);
            }
            
            return websiteUrl;
            
        } catch (error) {
            console.log('Error extracting website:', error);
            return '';
        }
    }
    
    // Optimized helper function to validate URLs faster
    function isValidWebsiteUrl(url) {
        if (!url || !url.startsWith('http')) return false;
        
        // Comprehensive exclusion check for non-business websites
        const excludedDomains = [
            'google.com', 'facebook.com', 'instagram.com', 'twitter.com', 
            'linkedin.com', 'youtube.com', 'maps.google', 'goo.gl',
            'bit.ly', 't.co', 'tinyurl.com', 'whatsapp.com', 'telegram.org',
            'maps.app.goo.gl', 'plus.google.com', 'yelp.com', 'tripadvisor.com',
            'foursquare.com', 'waze.com', 'pinterest.com', 'snapchat.com',
            'tiktok.com', 'trustpilot.com', 'booking.com', 'airbnb.com'
        ];
        
        // Check if URL contains any excluded domain
        return !excludedDomains.some(domain => url.toLowerCase().includes(domain));
    }

    // Helper function to extract data from the current view and extract websites immediately
    async function extractDataFromPageWithWebsites() {
        // Target the specific Google Maps search results structure
        var searchResults = Array.from(document.querySelectorAll('div[jsaction*="mouseover:pane.wfvdle"]'));
        
        const extractedItems = [];
        
        // Process items in smaller batches for better performance
        for (let container of searchResults) {
            if (!container) continue;

            // Extract the main link to get the Google Maps URL
            var mainLink = container.querySelector('a.hfpxzc');
            if (!mainLink || !mainLink.href.includes('google.com/maps/place')) continue;

            // Use the main Google Maps link href as unique identifier
            const itemIdentifier = mainLink.href;
            
            // Skip if we already have this item
            if (scrapedItemIdentifiers.has(itemIdentifier)) continue;

            var titleText = '';
            var phone = '';
            var industry = '';
            var cityCountry = '';

            // Extract title from the headline
            var titleElement = container.querySelector('.qBF1Pd.fontHeadlineSmall');
            if (titleElement) {
                titleText = titleElement.textContent.trim();
            }

            // Quick pre-filter: Skip businesses that are unlikely to have websites
            if (titleText.match(/^\d+\s/) || // Starts with address number
                titleText.match(/apartment|flat|residence|villa|house|atm|parking/i) || // Residential/non-business
                titleText.length < 3) { // Too short to be a real business
                console.log(`⏭️ Skipping ${titleText} - not a business`);
                continue;
            }

            // Fast extraction of basic info
            var phoneElement = container.querySelector('span.UsdlK');
            if (phoneElement) {
                phone = phoneElement.textContent.trim();
            }

            // Quick industry and location extraction
            var infoElements = container.querySelectorAll('.W4Efsd .W4Efsd span');
            var infoTexts = Array.from(infoElements).map(el => el.textContent.trim()).filter(text => text && text !== '·');
            
            if (infoTexts.length > 0) {
                industry = infoTexts[0];
            }

            // Fast location extraction
            for (let i = 1; i < infoTexts.length; i++) {
                var text = infoTexts[i];
                if (text.match(/closed|open|am|pm|delivery|in-store|pickup/i)) continue;
                if (text === phone) continue;
                
                if (!text.match(/street|st\s|road|rd\s|avenue|ave\s|building|floor|ground|shop|unit|plot|showroom|suite|apt|apartment/i)) {
                    if (text.length > 3 && text.length < 50 && !text.match(/^\d+/) && !text.match(/floor|level|unit|shop/i)) {
                        if (text.match(/,|\s-\s/) || text.match(/^[A-Z][a-z]+(\s[A-Z][a-z]*)*$/)) {
                            cityCountry = text;
                            break;
                        }
                    }
                }
            }
            
            // Quick fallback for location
            if (!cityCountry) {
                var currentUrl = window.location.href;
                var urlLocationMatch = currentUrl.match(/maps\/search\/[^\/]*\+in\+([^\/&?]+)/i);
                if (urlLocationMatch) {
                    cityCountry = decodeURIComponent(urlLocationMatch[1]).replace(/\+/g, ' ');
                }
            }
            
            if (cityCountry) {
                cityCountry = cityCountry.replace(/^(in\s+|near\s+|at\s+)/i, '').trim();
                if (cityCountry.length > 80) {
                    cityCountry = cityCountry.substring(0, 80) + '...';
                }
            }

            // Fast website extraction
            console.log(`🚀 Processing: ${titleText}`);
            const websiteUrl = await extractWebsiteFromPlace(container);
            
            const item = {
                identifier: itemIdentifier,
                title: titleText,
                phone: phone,
                industry: industry,
                cityCountry: cityCountry,
                companyUrl: websiteUrl || '',
                href: itemIdentifier,
            };

            extractedItems.push(item);
            scrapedItemIdentifiers.add(itemIdentifier);
            
            if (websiteUrl) {
                console.log(`✅ ${titleText} → ${websiteUrl}`);
            } else {
                console.log(`⚪ ${titleText} → No website`);
            }

            // Minimal delay for maximum speed
            await wait(500);
            
            // Check limits
            if (extractedItems.length >= MAX_ITEMS_LIMIT) {
                console.log(`🎯 Reached limit: ${MAX_ITEMS_LIMIT} items`);
                break;
            }
        }
        
        return extractedItems;
    }

    // Function to scroll the results panel
    function scrollPanel(panel) {
        if (panel) {
            const currentScrollTop = panel.scrollTop;
            panel.scrollTop = panel.scrollHeight;
            // Return true if we actually scrolled
            return panel.scrollTop > currentScrollTop;
        }
        return false;
    }

    // Promise wrapper for setTimeout
    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Attempt to find the scrollable element - updated for the new structure
    let scrollableElement = document.querySelector('div[role="feed"]');
    
    // If role="feed" is not found, try alternative selectors
    if (!scrollableElement) {
        // Look for the main results container
        scrollableElement = document.querySelector('.m6QErb.DxyBCb.kA9KIf.dS8AEf.XiKgde.ecceSd[role="feed"]');
    }
    
    if (!scrollableElement) {
        // Fallback: find any scrollable div that contains search results
        const containers = Array.from(document.querySelectorAll('div'));
        scrollableElement = containers.find(div => {
            return div.scrollHeight > div.clientHeight && 
                   div.querySelector('div[jsaction*="mouseover:pane.wfvdle"]') &&
                   getComputedStyle(div).overflowY !== 'visible';
        });
    }

    if (!scrollableElement) {
        console.warn("Scrollable element not found. Scraping only visible items.");
        // If no scrollable element, just scrape what's visible and return
        const initialItems = await extractDataFromPageWithWebsites();
        allItems.push(...initialItems);
        console.log(`Scraped ${allItems.length} items (no scrolling, limit: ${MAX_ITEMS_LIMIT})`);
        return allItems;
    }
    
    console.log("Found scrollable element:", scrollableElement);
    
    // Main scrolling and scraping loop with improved logic
    let consecutiveNoNewItems = 0;
    const MAX_CONSECUTIVE_NO_NEW_ITEMS = 3;
    
    while (scrollAttempts < MAX_SCROLLS && consecutiveNoNewItems < MAX_CONSECUTIVE_NO_NEW_ITEMS && allItems.length < MAX_ITEMS_LIMIT) {
        const previousItemCount = allItems.length;
        const newItems = await extractDataFromPageWithWebsites();

        // Add new items to our collection
        allItems.push(...newItems);
        const newItemsFound = newItems.length;

        console.log(`Scroll ${scrollAttempts + 1}: Found ${newItemsFound} new items with websites. Total items: ${allItems.length}/${MAX_ITEMS_LIMIT}`);

        // Check if we've reached the limit
        if (allItems.length >= MAX_ITEMS_LIMIT) {
            console.log(`Reached maximum limit of ${MAX_ITEMS_LIMIT} items.`);
            break;
        }

        if (newItemsFound > 0) {
            consecutiveNoNewItems = 0;
        } else {
            consecutiveNoNewItems++;
        }

        // Try to scroll
        const didScroll = scrollPanel(scrollableElement);
        scrollAttempts++;
        
        if (!didScroll) {
            console.log("Could not scroll further, likely reached the end.");
            break;
        }
        
        await wait(SCROLL_DELAY);

        // Additional check: if we haven't found new items in several attempts, try a longer wait
        if (consecutiveNoNewItems >= 2) {
            console.log("No new items found recently, waiting longer for content to load...");
            await wait(SCROLL_DELAY * 2);
        }
    }
    
    console.log(`Scraping completed. Total scrolls: ${scrollAttempts}, Total items with websites: ${allItems.length}/${MAX_ITEMS_LIMIT}`);
    return allItems;
}

// Convert the table to a CSV string
function tableToCsv(table) {
    var csv = [];
    var rows = table.querySelectorAll('tr');
    
    for (var i = 0; i < rows.length; i++) {
        var row = [], cols = rows[i].querySelectorAll('td, th');
        
        for (var j = 0; j < cols.length; j++) {
            // Ensure double quotes within the cell text are escaped by doubling them
            let cellText = cols[j].innerText.replace(/"/g, '""');
            row.push('"' + cellText + '"');
        }
        csv.push(row.join(','));
    }
    return csv.join('\n');
}

// Download the CSV file
function downloadCsv(csv, filename) {
    var csvFile;
    var downloadLink;

    csvFile = new Blob([csv], {type: 'text/csv;charset=utf-8;'});
    downloadLink = document.createElement('a');
    downloadLink.download = filename;
    downloadLink.href = window.URL.createObjectURL(csvFile);
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink); // Clean up the link
}